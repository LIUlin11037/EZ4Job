"""用大模型复核岗位是否值得投递。

设计原则：
1. 规则先跑，规则判 0 分（明确不投）的岗位不浪费 token；
2. 只让模型做"二选一 + 打分"，输出 JSON，温度 0，结果可缓存；
3. 任何异常都回落到规则分，不影响主流程；
4. 默认关闭，配好 key 再打开。
"""

import hashlib
import json
import os
import re
import time
from collections import OrderedDict

import httpx

from config import Config

_SYSTEM_PROMPT = """你是求职投递筛选器，负责把不合适的岗位挡掉。判断下面这个岗位是否值得投递。

【求职者】{profile}

【投递要求】
{rules}

【输出】只输出一个 JSON 对象，不要任何解释文字：
{{
  "apply": true 或 false,
  "score": 0-100 的整数（与目标的匹配度）,
  "role_type": "agent_dev" | "ai_dev" | "backend_dev" | "algo" | "product" | "marketing" | "ops" | "test" | "other",
  "language": "python" | "java" | "both" | "other" | "unclear",
  "reason": "不超过 40 个汉字，说明判断依据"
}}

"role_type" 必须按岗位真实职能填，不要因为 JD 里出现 AI 字样就往上靠：
- agent_dev：核心工作就是 Agent / 智能体 / 大模型应用开发（编排、RAG、工具调用、Prompt、评测）
- ai_dev：其他方向的 AI 应用开发（AI 功能接入、模型服务化、AI 工作流）
- backend_dev：以 Java 为主（或 Java + 前端）的后端 / 全栈 / 服务端开发，
  典型技术栈 Spring Boot / Spring Cloud / MyBatis / MySQL / Redis / Kafka / 微服务。
  求职者 Java 后端能力完整，这类岗 apply=true
- algo：训练/微调/推理优化/算法研究 → apply 必须 false
- product / marketing / ops / test：对应职能 → apply 必须 false
- other：非 Java 技术栈的普通后端/全栈/业务系统开发（C++/Go/Node/PHP）、纯前端、
  数据库业务开发、泛化软件开发 → apply 必须 false

判断顺序：先判断"这岗位是不是真的写代码做研发"，再判断技术栈是不是 Java 或 Python。
不是研发职能（产品/运营/销售/售前/交付/测试/运维/实施）→ 直接 false。
是研发但主语言是 C++/C#/Go/Rust/PHP 或纯前端 → false。
只有 Java 后端 / Java 全栈 / Python 后端 / Agent 与 AI 应用开发才允许 apply=true。
"language" 看岗位要求的主要编程语言，C++/C#/Rust/Go/PHP/前端 一律填 other。
"""


class _Cache:
    def __init__(self, max_size: int):
        self.max_size = max(16, int(max_size or 800))
        self.data = OrderedDict()

    def get(self, key: str):
        if key not in self.data:
            return None
        self.data.move_to_end(key)
        return self.data[key]

    def set(self, key: str, value):
        self.data[key] = value
        self.data.move_to_end(key)
        if len(self.data) > self.max_size:
            self.data.popitem(last=False)

    def __len__(self):
        return len(self.data)


_cfg = Config.llm if isinstance(Config.llm, dict) else {}
_cache = _Cache(_cfg.get('cache_size', 800))
_call_count = 0


def _fence_strip(text: str) -> str:
    text = (text or '').strip()
    if text.startswith('```'):
        text = re.sub(r'^```[a-zA-Z]*\s*', '', text)
        text = re.sub(r'```\s*$', '', text)
    return text.strip()


def resolve_api_key() -> str:
    env_name = str(_cfg.get('api_key_env') or '').strip()
    if env_name and os.environ.get(env_name):
        return os.environ[env_name].strip()
    return str(_cfg.get('api_key') or '').strip()


def is_enabled() -> bool:
    if not _cfg.get('enabled'):
        return False
    if str(_cfg.get('mode') or 'off').lower() == 'off':
        return False
    return bool(resolve_api_key())


def describe() -> str:
    if not _cfg.get('enabled'):
        return '大模型复核：未启用'
    if not resolve_api_key():
        return f"大模型复核：已开启但没读到 API Key（环境变量 {_cfg.get('api_key_env') or '-'} 或 llm.api_key）"
    return f"大模型复核：{_cfg.get('model')} / mode={_cfg.get('mode')}"


def should_call(rule_score: int, thread: int) -> bool:
    """按 mode 决定要不要花这次 token。"""
    if not is_enabled():
        return False
    max_calls = int(_cfg.get('max_calls_per_run') or 0)
    if max_calls > 0 and _call_count >= max_calls:
        return False
    mode = str(_cfg.get('mode') or 'veto').lower()
    if mode == 'always':
        return True
    if mode == 'hybrid':
        # 硬拦截（0 分）不花 token，其余都让模型看一眼
        return rule_score > 0
    # 默认 veto：只复核已经过线的岗位，只允许否决
    return rule_score >= thread


def _endpoint() -> str:
    base = str(_cfg.get('base_url') or 'https://api.deepseek.com').rstrip('/')
    if base.endswith('/chat/completions'):
        return base
    return base + '/chat/completions'


def _cache_key(title: str, detail: str) -> str:
    raw = f"{title}\n{detail[:600]}".encode('utf-8')
    return hashlib.sha1(raw).hexdigest()


def _parse_verdict(content: str) -> dict:
    data = json.loads(_fence_strip(content))
    if not isinstance(data, dict) or 'apply' not in data:
        raise ValueError(f'模型返回结构不符合预期: {content[:120]}')
    role = str(data.get('role_type') or 'other').strip().lower()
    if role not in {'agent_dev', 'ai_dev', 'backend_dev', 'algo', 'product', 'marketing', 'ops', 'test', 'other'}:
        role = 'other'
    language = str(data.get('language') or 'unclear').strip().lower()
    if language not in {'python', 'java', 'both', 'other', 'unclear'}:
        language = 'unclear'
    try:
        score = int(data.get('score') or 0)
    except (TypeError, ValueError):
        score = 0
    return {
        'apply': bool(data.get('apply')),
        'score': max(0, min(100, score)),
        'role_type': role,
        'language': language,
        'reason': str(data.get('reason') or '').strip()[:80],
    }


def judge(title: str, detail: str, rule_score: int = 0) -> dict | None:
    """调用模型判断单个岗位。失败返回 None（调用方回落到规则分）。"""
    global _call_count

    if not is_enabled():
        return None

    key = _cache_key(title, detail)
    cached = _cache.get(key)
    if cached is not None:
        return {**cached, 'cached': True}

    system = _SYSTEM_PROMPT.format(
        profile=_cfg.get('target_profile') or '',
        rules=_cfg.get('exclude_rules') or '',
    )
    jd = (detail or '')[: int(_cfg.get('jd_max_chars') or 1500)]
    payload = {
        'model': _cfg.get('model') or 'deepseek-flash',
        'messages': [
            # system 固定放最前，命中上下文缓存更便宜
            {'role': 'system', 'content': system},
            {'role': 'user', 'content': f'# 岗位名称\n{title}\n\n# 职位描述\n{jd}'},
        ],
        'temperature': _cfg.get('temperature', 0),
        'max_tokens': int(_cfg.get('max_tokens') or 200),
        'response_format': {'type': 'json_object'},
        # 显式关闭思考模式：判岗不需要思维链，开着会多烧几倍输出 token
        'thinking': {'type': 'enabled' if _cfg.get('thinking') else 'disabled'},
        'stream': False,
    }
    headers = {
        'Authorization': f'Bearer {resolve_api_key()}',
        'Content-Type': 'application/json',
    }

    started = time.time()
    last_error = None
    for attempt in range(2):
        try:
            timeout = float(_cfg.get('timeout_s') or 12)
            with httpx.Client(timeout=timeout) as client:
                resp = client.post(_endpoint(), headers=headers, json=payload)
            if resp.status_code == 429 or resp.status_code >= 500:
                last_error = f'HTTP {resp.status_code}'
                time.sleep(0.8 * (attempt + 1))
                continue
            resp.raise_for_status()
            body = resp.json()
            content = body['choices'][0]['message']['content']
            verdict = _parse_verdict(content)
            verdict.update({
                'cached': False,
                'model': payload['model'],
                'latency_ms': int((time.time() - started) * 1000),
                'usage': body.get('usage') or {},
            })
            _cache.set(key, {k: v for k, v in verdict.items() if k not in {'cached', 'latency_ms', 'usage'}})
            _call_count += 1
            return verdict
        except Exception as exc:  # 网络/解析/鉴权异常都回落
            last_error = f'{type(exc).__name__}: {exc}'
            time.sleep(0.4)

    print(f'[llm] 判岗失败，已回落规则分: {last_error}', flush=True)
    return None


def apply_verdict(rule_result: dict, verdict: dict | None, thread: int) -> dict:
    """把模型结论合并回规则结果，返回新的 result（不改引入语和简历索引）。"""
    if not verdict:
        return rule_result

    merged = dict(rule_result)
    base = int(rule_result.get('score') or 0)

    role = verdict.get('role_type')
    language = verdict.get('language')
    apply_flag = bool(verdict.get('apply'))
    reason = str(verdict.get('reason') or '')

    # 捞回闸门：规则分不够（标题没方向词）时，模型必须同时满足三条才允许抬分，
    # 否则会把“Python”“java实习生”“后端开发”这类泛化岗一路投出去。
    min_title = int((Config.scoring or {}).get('min_title_score', 86) or 86)
    allow_java_backend = bool((Config.llm or {}).get('allow_java_backend', True))
    if apply_flag and base < min_title:
        title = str(rule_result.get('title') or '')
        has_direction = re.search(
            r'(ai|大模型|llm|agent|智能体|rag|mcp|langchain|langgraph|prompt|提示词|人工智能)',
            title, re.I
        ) is not None
        model_score = int(verdict.get('score') or 0)
        # Java 技术栈的后端/开发岗放行：本人 Java 后端能力完整，搜到就投。
        # 这类岗模型自评分本来就不会高（不是 AI 岗），所以只看它的 apply 和 language，不卡 85 分。
        java_backend = (
            allow_java_backend
            and language in {'java', 'both'}
            and role in {'agent_dev', 'ai_dev', 'backend_dev'}
        )
        if java_backend:
            pass
        elif not has_direction:
            apply_flag = False
            reason = f'{reason}｜标题没有 AI 方向词且不是 Java 技术栈，不捞回'
        elif role != 'agent_dev':
            apply_flag = False
            reason = f'{reason}｜标题无方向词且模型只判到 {role}，不捞回'
        elif model_score < 85:
            apply_flag = False
            reason = f'{reason}｜模型自评分 {model_score} 不足 85，不捞回'

    # 双重保险：模型说 apply，但职能/语言与画像不符 → 一律按不投处理
    if apply_flag and role not in {'agent_dev', 'ai_dev', 'backend_dev'}:
        apply_flag = False
        reason = f'{reason}（职能是{role}）'
    if apply_flag and language == 'other':
        apply_flag = False
        reason = f'{reason}（语言不匹配）'

    if apply_flag:
        # 模型认为值得投：至少抬到阈值以上；本来更高就保留
        final = max(base, int(verdict.get('score') or 0), min(thread + 5, 100))
    else:
        # 模型否决：压到阈值以下
        final = min(base, max(0, thread - 10))

    merged['rule_score'] = base
    merged['score'] = max(0, min(100, final))
    merged['llm_apply'] = apply_flag
    merged['llm_role'] = role
    merged['llm_language'] = language
    merged['llm_reason'] = reason
    merged['llm_cached'] = bool(verdict.get('cached'))
    merged['llm_model'] = verdict.get('model')
    merged['llm_latency_ms'] = verdict.get('latency_ms')
    merged['llm_usage'] = verdict.get('usage')
    if not apply_flag:
        merged['reason'] = f'大模型否决（{role}/{language}）：{reason}'
    elif base < thread:
        merged['reason'] = f'大模型捞回（{role}/{language}）：{reason}'
    return merged


if __name__ == '__main__':
    import sys

    if len(sys.argv) < 2:
        print(describe())
        print('用法: python llm_judge.py "岗位名称" "职位描述"')
        raise SystemExit(0)
    title_arg = sys.argv[1]
    detail_arg = sys.argv[2] if len(sys.argv) > 2 else ''
    print(describe())
    result = judge(title_arg, detail_arg)
    print(json.dumps(result, ensure_ascii=False, indent=2) if result else '无结果（未启用或调用失败）')
