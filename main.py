from datetime import datetime
import asyncio
import random
import json
from pathlib import Path
from fastapi import FastAPI, Body, HTTPException
from core import replyMsg, isNeedResume, isNeedWorks, evaluateSingleRouteDelivery
from schema import Msg
from config import Config
import llm_judge


app = FastAPI()
LOG_PATH = Path(__file__).resolve().parent / 'job_decisions.jsonl'
ACTION_LOG_PATH = Path(__file__).resolve().parent / 'job_actions.jsonl'


def append_job_decision_log(result: dict, raw_job: str, delay_ms: int):
    log_record = {
        'loggedAt': datetime.now().isoformat(timespec='seconds'),
        'title': result.get('title'),
        'detail': result.get('detail'),
        'matchedField': result.get('matched_field'),
        'keyword': result.get('keyword'),
        'score': result.get('score'),
        'ruleScore': result.get('rule_score'),
        'llmApply': result.get('llm_apply'),
        'llmRole': result.get('llm_role'),
        'llmLanguage': result.get('llm_language'),
        'llmReason': result.get('llm_reason'),
        'llmModel': result.get('llm_model'),
        'llmCached': result.get('llm_cached'),
        'llmLatencyMs': result.get('llm_latency_ms'),
        'introduce': result.get('introduce'),
        'resumeIndex': result.get('resumeIndex'),
        'titleScore': result.get('title_score'),
        'detailScore': result.get('detail_score'),
        'comboScore': result.get('combo_score'),
        'titlePenaltyScore': result.get('title_penalty_score'),
        'penaltyScore': result.get('penalty_score'),
        'reason': result.get('reason'),
        'delayMs': delay_ms,
        'rawJob': raw_job,
    }
    with LOG_PATH.open('a', encoding='utf-8') as f:
        f.write(json.dumps(log_record, ensure_ascii=False) + '\n')


def append_job_action_log(action: dict):
    action_record = {
        'loggedAt': datetime.now().isoformat(timespec='seconds'),
        **action,
    }
    with ACTION_LOG_PATH.open('a', encoding='utf-8') as f:
        f.write(json.dumps(action_record, ensure_ascii=False) + '\n')


@app.get("/tags", summary="获取职位标签")
async def get_tags():
    return {
        'tags': Config.tags
    }


@app.get("/get-introduce", summary="获取自我介绍")
async def get_introduce():
    return {
        'introduce': Config.get_default_introduce()
    }


@app.get("/client-config", summary="获取前端运行配置")
async def get_client_config():
    return Config.get_client_config()


@app.post("/get-job-score", summary="获取职位匹配度")
async def get_job_score(job: str = Body(..., description="职位信息")):
    result = evaluateSingleRouteDelivery(job)
    thread = int(Config.frontend.get('thread') or 0)

    # 规则先过一遍，再让大模型复核（默认关闭，见 user_config.json 的 llm 段）
    verdict = None
    if llm_judge.should_call(result['score'], thread):
        verdict = await asyncio.to_thread(
            llm_judge.judge, result.get('title') or '', result.get('detail') or '', result['score']
        )
        result = llm_judge.apply_verdict(result, verdict, thread)

    delay_ms = max(0, Config.job_score_delay_base_ms + random.randint(
        -Config.job_score_delay_jitter_ms,
        Config.job_score_delay_jitter_ms,
    ))
    time_str = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    title = result['title'] or '未识别标题'
    keyword = result['keyword'] or '无'
    matched_field_map = {
        'title': '岗位名称',
        'detail': '职位描述',
        'none': '未命中',
        'title_negative': '标题负向拦截',
        'title_nondev': '职能不符',
    }
    llm_part = ''
    if verdict is not None:
        cache_flag = ',cache' if verdict.get('cached') else ''
        llm_part = (
            f" | llm={'apply' if verdict.get('apply') else 'skip'}"
            f"/{verdict.get('role_type')}/{verdict.get('language')}"
            f"({verdict.get('latency_ms')}ms{cache_flag})"
            f"/{verdict.get('reason')}"
        )
    rule_part = ''
    if result.get('rule_score') is not None:
        rule_part = f"(规则{result['rule_score']})"
    print(
        f"[{time_str}] /get-job-score | "
        f"title={title} | "
        f"matched={matched_field_map.get(result['matched_field'], result['matched_field'])} | "
        f"keyword={keyword} | "
        f"title_score={result['title_score']} | "
        f"detail_score={result['detail_score']} | "
        f"combo_score={result['combo_score']} | "
        f"title_penalty_score={result.get('title_penalty_score', 0)} | "
        f"penalty_score={result['penalty_score']} | "
        f"delay_ms={delay_ms} | "
        f"score={result['score']}{rule_part} | "
        f"reason={result['reason']}"
        f"{llm_part}",
        flush=True
    )
    append_job_decision_log(result, job, delay_ms)
    await asyncio.sleep(delay_ms / 1000)
    return {
        'score': result['score'],
        'introduce': result['introduce'],
        'resumeIndex': result['resumeIndex'],
    }


@app.post("/log-action", summary="记录前端动作日志")
async def log_action(action: dict = Body(..., description="动作日志")):
    append_job_action_log(action)
    return {'success': True}


@app.get("/greet-stats", summary="今日打招呼统计（用于校准前端日限计数）")
async def greet_stats():
    today = datetime.now().strftime('%Y-%m-%d')
    greeted = 0
    failed = 0
    if ACTION_LOG_PATH.exists():
        with ACTION_LOG_PATH.open('r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    record = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if not str(record.get('loggedAt', '')).startswith(today):
                    continue
                action = record.get('action')
                if action == 'chat_open_requested':
                    greeted += 1
                elif action == 'greet_queue_failed':
                    failed += 1
    return {'date': today, 'greeted': greeted, 'failed': failed}


@app.get("/llm-status", summary="查看大模型复核状态")
async def llm_status():
    return {
        'enabled': llm_judge.is_enabled(),
        'describe': llm_judge.describe(),
        'mode': Config.llm.get('mode'),
        'model': Config.llm.get('model'),
        'baseUrl': Config.llm.get('base_url'),
        'calls': llm_judge._call_count,
        'cacheSize': len(llm_judge._cache),
    }


@app.post("/reply", summary="回复消息")
async def reply(msgs: list[Msg] = Body(..., description="消息列表")):
    try:
        return replyMsg(msgs, '', Config.character)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e


@app.post("/is-need-resume", summary="是否需要简历")
async def is_need_resume(msgs: list[Msg] = Body(..., description="消息列表")):
    try:
        return {
            'need': isNeedResume(msgs)
        }
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e


@app.post("/is-need-works", summary="是否需要作品集")
async def is_need_works(msgs: list[Msg] = Body(..., description="消息列表")):
    try:
        return {
            'need': isNeedWorks(msgs)
        }
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e


if __name__ == '__main__':
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
