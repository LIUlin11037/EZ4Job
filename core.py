try:
    from ollama import chat, Message
except ImportError:
    chat = None
    Message = None
from prompts import INTRODUCE, TAGS, CHARACTER, CHAT, INTERSET, NEEDRESUME, NEEDWORKS
from config import Config
from tools import getLLMReply
from schema import InterestValue, NeedResume, NeedWorks
import json
import re


# 默认参数
options = {
    "temperature": 0.6,
    "num_ctx": 10240
}


LEGACY_OLLAMA_REQUIRED_MESSAGE = '当前接口依赖 ollama，但主链评分/固定招呼/直接发简历已支持在未安装 ollama 时启动运行'

# 这些词只说明“是开发岗”，不说明技术栈。标题里写明 JS 技术栈时要先剔掉，
# 否则 "Node.js后端开发" 靠 '后端开发' 就能拿到 88 分。
_GENERIC_BACKEND_KEYWORDS = {
    '后端开发工程师', '后端开发', '后端工程师', '服务端开发',
    '全栈开发', '全栈工程师', '全栈',
    'full stack', 'fullstack', 'full-stack',
}


def isOllamaAvailable() -> bool:
    return chat is not None and Message is not None


def __ensure_ollama_available():
    if not isOllamaAvailable():
        raise RuntimeError(LEGACY_OLLAMA_REQUIRED_MESSAGE)


def __streamChat(sys_prompt: str, prompt: str, options: dict = options, model: str = Config.think_model) -> str:
    """自定义的流式回复"""
    __ensure_ollama_available()
    content = ''
    for i in chat(model, [
        Message(role='system', content=sys_prompt),
        Message(role='user', content=prompt)
    ], stream=True, options=options):
        word = i.message.content
        content += word
        print(word, end="", flush=True)
    print()
    return getLLMReply(content)


def getIntroduce(resume: str):
    """生成自我介绍"""
    return __streamChat(INTRODUCE, resume)


def getTags(resume: str):
    """获取匹配标签"""
    return __streamChat(TAGS, resume).split(' ')


def getCharacter(resume: str):
    """获取性格特点"""
    return __streamChat(CHARACTER, resume)


def __extract_job_fields(job: str) -> tuple[str, str]:
    """从脚本上传的文本中提取岗位名称和职位描述。"""
    sections = [section.strip() for section in re.split(r'\n\s*\n', job) if section.strip()]
    title = ''
    detail = job.strip()
    if sections:
        title_lines = sections[0].splitlines()
        if len(title_lines) > 1:
            title = '\n'.join(title_lines[1:]).strip()
    if len(sections) >= 3:
        detail_lines = sections[2].splitlines()
        if len(detail_lines) > 1:
            detail = '\n'.join(detail_lines[1:]).strip()
    return title, detail


def __normalize_text(text: str) -> str:
    return text.lower()


def __compact_text(text: str) -> str:
    """去掉空白与常见分隔符，避免 “AI Agent 开发 / AI-Agent开发 / AI Agent（开发）” 匹配不上。"""
    # 注意：只去空白和结构性分隔符，保留 + / - # 等有语义的字符（c++、a/b、c#）
    return re.sub(r'[\s·•—–_|\\（）()\[\]【】{}<>《》,，.。;；:：!！?？"“”\'‘’*]+', '', text.lower())


def __find_matches(text: str, keyword_scores: dict[str, int]) -> list[tuple[str, int]]:
    normalized = __normalize_text(text)
    compact = __compact_text(text)
    matches = []
    for keyword, score in keyword_scores.items():
        key = keyword.lower()
        if key in normalized or __compact_text(key) in compact:
            matches.append((keyword, score))
    return matches


def evaluateJobMatch(job: str):
    """返回岗位匹配明细，便于日志排查。"""
    title, detail = __extract_job_fields(job)
    title_block_matches = __find_matches(title, Config.title_block_keywords)
    if title_block_matches:
        return {
            'title': title,
            'detail': detail,
            'matched_field': 'title_negative',
            'keyword': title_block_matches[0][0],
            'score': 0,
            'blocked': True,
            'title_score': 0,
            'detail_score': 0,
            'penalty_score': 0,
            'title_penalty_score': 0,
            'combo_score': 0,
            'final_score': 0,
            'title_match_level': 'negative',
            'title_matches': [keyword for keyword, _ in title_block_matches],
            'title_penalty_matches': [],
            'detail_infra_matches': [],
            'detail_support_matches': [],
            'detail_backend_matches': [],
            'detail_negative_matches': [],
            'reason': '岗位名称命中强负向关键词',
        }

    # 职能门控：先把“不是研发岗”的标题挡掉。
    # 否则 “GTM/市场/售前/产品” 这类岗位只要标题里带 AI Agent，就能靠正向词拿满分。
    # 例外短语先剔除，避免 “一级市场/二级市场” 这种金融术语被当成营销岗。
    gate_title = title
    for phrase in Config.title_nondev_exceptions:
        gate_title = gate_title.replace(phrase, '')
    title_nondev_matches = __find_matches(gate_title, Config.title_nondev_keywords)
    if title_nondev_matches:
        return {
            'title': title,
            'detail': detail,
            'matched_field': 'title_nondev',
            'keyword': title_nondev_matches[0][0],
            'score': 0,
            'blocked': True,
            'title_score': 0,
            'detail_score': 0,
            'penalty_score': 0,
            'title_penalty_score': 0,
            'combo_score': 0,
            'final_score': 0,
            'title_match_level': 'nondev',
            'title_matches': [keyword for keyword, _ in title_nondev_matches],
            'title_penalty_matches': [],
            'detail_infra_matches': [],
            'detail_support_matches': [],
            'detail_backend_matches': [],
            'detail_negative_matches': [],
            'reason': f'岗位职能不是研发（命中「{title_nondev_matches[0][0]}」）',
        }

    # "JavaScript / Node.js / TypeScript" 也是 java 开头，匹配强正向词前先剔除，
    # 否则 "JavaScript开发工程师" 会被当成 Java 后端岗（词表里有裸 'java'）。
    is_js_title = re.search(r'javascript|typescript|node\.?js|nodejs', title, flags=re.I)
    match_title = re.sub(r'javascript|typescript|node\.?js|nodejs', ' ', title, flags=re.I)
    title_strong_matches = __find_matches(match_title, Config.title_strong_keywords)
    if is_js_title:
        # 标题里已经写明 JS 技术栈：把“后端开发/全栈”这类泛化词也去掉，
        # 否则 "Node.js后端开发" 会靠 '后端开发' 拿 88 分 → 一路投到 JS 岗。
        title_strong_matches = [m for m in title_strong_matches if m[0] not in _GENERIC_BACKEND_KEYWORDS]
    # JS 技术栈的标题连中等信号也不给（否则 "JavaScript开发" 会靠 'java' 拿 40 分）
    title_medium_matches = [] if is_js_title else __find_matches(title, Config.title_medium_keywords)
    title_match_level = 'none'
    title_keyword = None
    title_score = 0
    title_matches: list[str] = []

    if title_strong_matches:
        title_keyword, title_score = max(title_strong_matches, key=lambda item: item[1])
        title_match_level = 'strong'
        title_matches = [keyword for keyword, _ in title_strong_matches]
    elif title_medium_matches:
        title_keyword, title_score = max(title_medium_matches, key=lambda item: item[1])
        title_match_level = 'medium'
        title_matches = [keyword for keyword, _ in title_medium_matches]

    title_penalty_matches = __find_matches(title, Config.title_penalty_keywords)
    detail_infra_matches = __find_matches(detail, Config.detail_infra_keywords)
    detail_support_matches = __find_matches(detail, Config.detail_support_keywords)
    detail_backend_matches = __find_matches(detail, Config.detail_backend_keywords)
    detail_negative_matches = __find_matches(detail, Config.detail_negative_keywords)

    detail_infra_score = min(sum(score for _, score in detail_infra_matches), 24)
    detail_support_score = min(sum(score for _, score in detail_support_matches), 12)
    # 后端技术栈单独一桶：Java/全栈岗的 JD 基本不会出现 Agent/RAG 关键词，
    # 只靠 support 桶那 12 分撑不到阈值，必须按自己的词表给分。
    detail_backend_score = min(sum(score for _, score in detail_backend_matches), 20)
    detail_score = detail_infra_score + detail_support_score + detail_backend_score
    title_penalty_score = min(sum(score for _, score in title_penalty_matches), 45)
    penalty_score = min(sum(score for _, score in detail_negative_matches), 36)

    combo_score = 0
    infra_keywords = {keyword for keyword, _ in detail_infra_matches}
    detail_match_count = len(detail_infra_matches) + len(detail_support_matches)
    title_normalized = __normalize_text(title)

    if title_match_level == 'strong' and len(detail_infra_matches) >= 2:
        combo_score += 10
    if title_match_level == 'medium' and detail_match_count >= 3:
        combo_score += 10
    if ('devops' in title_normalized or 'sre' in title_normalized) and infra_keywords.intersection({'k8s', 'kubernetes', 'docker', 'prometheus'}):
        combo_score += 10
    # 后端岗的组合分：标题强命中 + JD 至少两个后端技术词（不叠加上面的 AI 组合分）
    if combo_score == 0 and title_match_level == 'strong' and len(detail_backend_matches) >= 2:
        combo_score += 10

    raw_score = title_score + detail_score + combo_score - title_penalty_score - penalty_score
    # 标题必须命中“目标方向词”。泛化词（web开发/python/后端…）即使 JD 里有 Agent 技术栈，
    # 也不该直接冲到阈值以上，否则会一路投到普通后端岗。
    min_title_score = int(Config.scoring.get('min_title_score', 86) or 86)
    if title_match_level == 'none':
        raw_score = min(raw_score, 55)
    elif title_score < min_title_score:
        raw_score = min(raw_score, 80)
    if not detail_infra_matches and not detail_support_matches and not detail_backend_matches:
        # 标题党：标题命中方向词，但 JD 里一点技术要求都没有（典型是市场/运营岗把 AI 写进标题）
        raw_score = min(raw_score, 80)
    final_score = max(0, min(100, raw_score))

    if title_match_level in ['strong', 'medium']:
        matched_field = 'title'
        keyword = title_keyword
        if title_penalty_matches:
            reason = '岗位名称命中正向关键词，但带有弱负向词扣分'
        else:
            reason = '岗位名称命中正向关键词'
    elif detail_infra_matches or detail_support_matches or detail_backend_matches:
        matched_field = 'detail'
        keyword = (detail_infra_matches + detail_support_matches + detail_backend_matches)[0][0]
        reason = '仅职位描述命中，已按标题缺失封顶'
    else:
        matched_field = 'none'
        keyword = None
        reason = '未命中有效关键词'

    return {
        'title': title,
        'detail': detail,
        'matched_field': matched_field,
        'keyword': keyword,
        'score': final_score,
        'blocked': False,
        'title_score': title_score,
        'detail_score': detail_score,
        'penalty_score': penalty_score,
        'title_penalty_score': title_penalty_score,
        'combo_score': combo_score,
        'final_score': final_score,
        'title_match_level': title_match_level,
        'title_matches': title_matches,
        'title_penalty_matches': [keyword for keyword, _ in title_penalty_matches],
        'detail_infra_matches': [keyword for keyword, _ in detail_infra_matches],
        'detail_support_matches': [keyword for keyword, _ in detail_support_matches],
        'detail_backend_matches': [keyword for keyword, _ in detail_backend_matches],
        'detail_negative_matches': [keyword for keyword, _ in detail_negative_matches],
        'reason': reason,
    }


def evaluateSingleRouteDelivery(job: str):
    match_result = evaluateJobMatch(job)
    return {
        **match_result,
        'introduce': Config.introduce,
        'resumeIndex': Config.frontend.get('resumeIndex', 0),
    }


def calcJobScore(job: str, resume: str):
    """计算职位匹配度"""
    return evaluateJobMatch(job)['score']


def __calcInterestValue(msgs: list):
    """计算兴趣值"""
    __ensure_ollama_available()
    msgs.insert(0, Message(role='system', content=INTERSET))
    return json.loads(chat(Config.chat_model, msgs, format=InterestValue.model_json_schema(), options={
        "temperature": 0.2,
        "num_ctx": 10240,
    }).message.content)['value']


def replyMsg(msgs: list, resume: str, character: str):
    __ensure_ollama_available()
    # 计算兴趣值
    interest = __calcInterestValue(list(msgs))
    if not interest:
        return ''
    # 获取回复
    content = ''
    msgs.insert(0, Message(role='system', content=CHAT.format(
        resume=resume,
        character=character
    )))
    for i in chat(Config.chat_model, messages=msgs, stream=True, options={
        "temperature": 0.4,
        "num_ctx": 10240,
    }):
        word = i.message.content
        content += word
        print(word, end="", flush=True)
    print()
    return getLLMReply(content)


def isNeedResume(msgs: list):
    """判断是否需要简历"""
    __ensure_ollama_available()
    msgs.insert(0, Message(role='system', content=NEEDRESUME))
    return json.loads(chat(Config.chat_model, msgs, format=NeedResume.model_json_schema(), options={
        "temperature": 0.2,
        "num_ctx": 10240,
    }).message.content)['need']


def isNeedWorks(msgs: list):
    """判断是否需要作品集"""
    __ensure_ollama_available()
    msgs.insert(0, Message(role='system', content=NEEDWORKS))
    return json.loads(chat(Config.chat_model, msgs, format=NeedWorks.model_json_schema(), options={
        "temperature": 0.2,
        "num_ctx": 10240,
    }).message.content)['need']
