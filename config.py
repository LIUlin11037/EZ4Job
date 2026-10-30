import copy
import json
import os


DEFAULT_USER_CONFIG = {
    'resume_name': 'resume.md',
    'think_model': 'qwen3:0.6b',
    'chat_model': 'qwen3:0.6b',
    'introduce': '您好，我主要做 AI 应用 / Agent 方向：用 Python + LangGraph 独立做过「Agent + RAG」的深度调研系统，做过子任务并行、工具按需装载、混合检索与引用核验，全链路接了可观测。找 AI 应用 / Agent 方向实习。',
    'character': '简洁 直接 礼貌',
    'tags': ['AI Agent', '智能体开发', 'AI应用开发', '大模型应用开发', 'RAG', '工作流工程师',
             'GenAI', 'LLM', 'Agent', '大模型', 'FDE'],
    'backend': {
        'job_score_delay_base_ms': 800,
        'job_score_delay_jitter_ms': 200,
    },
    # 大模型复核（OpenAI 兼容接口，默认关闭）
    # mode: off 不调用 / veto 只复核已过阈值的岗位（最省钱）/
    #       hybrid 非硬拦截岗位都复核（能捞回漏判）/ always 全部复核
    'llm': {
        'enabled': False,
        'mode': 'hybrid',
        'base_url': 'https://api.deepseek.com',
        'api_key': '',
        'api_key_env': 'DEEPSEEK_API_KEY',
        'model': 'deepseek-flash',
        # 关闭思考模式：JSON 判岗不需要思维链，开了会多烧几倍输出 token
        'thinking': False,
        'timeout_s': 12,
        'max_tokens': 200,
        'temperature': 0,
        'jd_max_chars': 1500,
        # Java 技术栈的后端岗搜到也投（不主动搜 Java）
        'allow_java_backend': True,
        'max_calls_per_run': 400,
        'cache_size': 800,
        # ⚠️ 示例模板，请改成你自己的情况：学校/届别、目标岗位、技术栈、1-2 个项目亮点。
        # 真实内容建议写在 user_config.json 的 llm.target_profile 里（该文件不入库）
        'target_profile': (
            '示例：某大学 本科在读，找 AI 应用 / Agent 方向实习，每周 4-5 天、3 个月以上。\n'
            '技术栈：Python 为主。\n'
            '- Agent / RAG：用 LangGraph 做过多智能体编排、MCP 工具调用、混合召回 + 重排，'
            '接入了 trace 与评测集。\n'
            '- 后端：能写服务并部署上线。\n'
            '目标岗位：AI Agent 开发 / AI 应用开发。'
        ),
        'exclude_rules': (
            '必须真的写代码做研发（AI 应用/Agent 开发，或 Java 后端 / 全栈开发），只是 JD 提到 AI、Agent、大模型不算。以下一律不投：\n'
            '1) 算法岗：模型训练/微调/预训练/SFT/RLHF/推理优化/算子/CUDA/量化、推荐/搜索/CV/NLP 算法、研究岗；\n'
            '2) 语言不匹配：C++/C#/Rust/Go/PHP/前端/客户端/Android/iOS/嵌入式/硬件/底层开发；\n'
            '3) 非研发职能：产品经理/产品助理、运营、市场、销售、商务、BD、售前、解决方案、实施交付、'
            '客户成功、客服、HR/招聘、财务、法务、设计、剪辑/短剧/配音等 AI 内容制作、数据标注、教研/讲师；\n'
            '3b) 后端 / 全栈：Java（或 Java + 前端）技术栈的可以投（apply=true, role_type=backend_dev, language=java）；'
            'Python 后端的也可以（language=python）；C++/Go/Node/PHP 技术栈不投；纯前端不投；\n'
            '4) 测试、运维、SRE、DevOps、外包/驻场/派遣；\n'
            '5) 标题像开发但 JD 主体是业务、销售、交付、写文档；\n'
            '6) 信息不足时偏向不投。'
        ),
    },
    'frontend': {
        'serverHost': 'http://127.0.0.1:8000',
        'thread': 90,
        # timestampTimeout 必须大于 detailTimeout，否则详情页永远赶不上时间窗
        'timestampTimeout': 45000,
        'onlyGreet': True,
        'manualFilterWaitMs': 15000,
        'roundRestartDelayMs': 4000,
        'maxEmptyRounds': 3,
        # 安全阀：0 表示不限制。Boss 平台硬上限 150 沟通/天，日限留 20 余量（手动操作也占额度）
        'maxGreetsPerDay': 130,
        'maxGreetsPerRun': 0,
        'maxRunHours': 6,
        'maxRounds': 0,
        'detailTimeout': 15000,
        'detailRetry': 1,
        'detailReadyTimeout': 6000,
        'detailOpenWaitMs': 400,
        'greetTimeout': 25000,
        'preloadScrollPixels': 400,
        'preloadScrollWaitMs': 700,
        'preloadStableRoundsLimit': 6,
        'preloadMaxRounds': 80,
        'preloadMaxJobs': 90,
        'preloadActivateCardEvery': 0,
        'preloadActivateCardWaitMs': 250,
        # Boss 回复后自动发简历：与 onlyGreet 无关，独立开关
        'autoSendResumeOnReply': True,
        'chatPollIntervalMs': 180000,
        'chatPollTimeout': 60000,
        'resumeIndex': 0,
        # 指定要发送的简历：匹配不到就不发（strict），避免发出平台模板简历
        'resume': {
            'name': '',
            'match': [],
            'exclude': ['在线简历', '模板简历'],
            'preferAttachment': True,
            'strict': True,
            'followUpText': '已发送，请查收',
            # 多方向简历：后端按 role_type 下发 resumeKey（agent / java），前端取这里对应的 match。
            # 配了 profiles 就只按方向取关键字，不再混用上面的全局 match。
            'defaultProfile': 'agent',
            'profiles': {},
        },
    },
    'scoring': {
        # 标题分低于这个值的一律压到阈值以下：标题必须命中“目标方向词”，
        # 只命中 web开发/python/后端 这类泛化词，哪怕 JD 写了 Agent 也不投。
        'min_title_score': 86,
        # 职能门控的例外短语：先剔除再匹配，避免“一级市场/二级市场”被当成营销岗
        'title_nondev_exceptions': ['一级市场', '二级市场', '资本市场', '市场驱动'],
        # 命中即 0 分（岗位方向不对，直接不投）
        'title_block_keywords': {
            '研究员': 100,
            '研究院': 100,
            '实验室': 100,
            '研究工程师': 100,
            '算法': 100,
            '算法工程师': 100,
            '算法研究员': 100,
            '机器学习算法': 100,
            '深度学习算法': 100,
            '推荐算法': 100,
            '搜索算法': 100,
            'cv算法': 100,
            'nlp算法': 100,
            '多模态算法': 100,
            'aigc算法': 100,
            '大模型算法': 100,
            '模型训练': 100,
            '模型研发': 100,
            '大模型研发': 100,
            '预训练': 100,
            '训练': 100,
            '微调': 100,
            'sft': 100,
            'rlhf': 100,
            'rlvr': 100,
            'ppo': 100,
            'dpo': 100,
            '推理优化': 100,
            '推理引擎': 100,
            '模型压缩': 100,
            '量化': 100,
            '算子': 100,
            'cuda': 100,
            'pytorch': 100,
            '论文': 100,
            '顶会': 100,
            '多模态大模型': 100,
            'cv': 100,
            'nlp': 100,
            # 产品经理类：不投
            '产品经理': 100,
            '产品实习': 100,
            '产品助理': 100,
            '产品策划': 100,
            '产品运营': 100,
            'ai产品': 100,
            '项目管理': 100,
            '项目经理': 100,
            # 非研发方向
            '测试': 100,
            '销售': 100,
            '商务': 100,
            '运营': 100,
            '客服': 100,
            '管培生': 100,
            '培训生': 100,
            '储备干部': 100,
            '储干': 100,
            '数据开发': 100,
            '数据治理': 100,
            '数据分析': 100,
            '数据标注': 100,
            '数据采集': 100,
            '嵌入式': 100,
            '硬件': 100,
            '渠道': 100,
            '光伏': 100,
            # AI 内容制作类（不是 Agent 应用开发）
            '短剧': 100,
            '剪辑': 100,
            '配音': 100,
            '主播': 100,
            '直播': 100,
            '电商': 100,
            '美工': 100,
            '平面设计': 100,
            '视觉设计': 100,
            '教研': 100,
            '讲师': 100,
            '课程顾问': 100,
            # 语言栈 / 用工形式（Python、Java 之外的一律不投）
            'c++': 100,
            'c语言': 100,
            'c#': 100,
            'rust': 100,
            'golang': 100,
            'go语言': 100,
            'php': 100,
            'machine learning': 100,
            '推理': 100,
            # 届别：只在“明确排除”时才拦，27届优先/校招这类只扣分
            '仅限27届': 100,
            '仅限2027届': 100,
            '仅限26届': 100,
            '仅限2026届': 100,
            '27届毕业生': 100,
            '2027届毕业生': 100,
            'deep learning': 100,
            'solutions engineer': 100,
            'sales engineer': 100,
            'data scientist': 100,
            '外包': 100,
            '驻场': 100,
            '派遣': 100,
            '兼职': 100,
            '众包': 100,
        },
        # 职能门控：命中即 0 分。判断的是“这个岗位干不干研发”，与技术方向无关。
        # 没有这一层，GTM / 市场 / 售前 / 产品 这类岗位只要标题带 "AI Agent" 就能拿满分。
        'title_nondev_keywords': {
            '产品': 100,
            '市场': 100,
            '营销': 100,
            '品牌': 100,
            'gtm': 100,
            '商务': 100,
            '销售': 100,
            '渠道': 100,
            '客户': 100,
            '运营': 100,
            '投放': 100,
            '新媒体': 100,
            '公关': 100,
            '招聘': 100,
            '人事': 100,
            'hrbp': 100,
            '行政': 100,
            '财务': 100,
            '会计': 100,
            '法务': 100,
            '采购': 100,
            '供应链': 100,
            '物流': 100,
            '仓储': 100,
            '咨询': 100,
            '投研': 100,
            '行研': 100,
            '证券': 100,
            '投资': 100,
            '战略': 100,
            '分析师': 100,
            '美工': 100,
            '视觉': 100,
            '交互设计': 100,
            '设计师': 100,
            '编辑': 100,
            '文案': 100,
            '主播': 100,
            '直播': 100,
            '客服': 100,
            '助教': 100,
            '讲师': 100,
            '教研': 100,
            '课程': 100,
            '翻译': 100,
            '售前': 100,
            '解决方案': 100,
            '实施': 100,
            '交付': 100,
            '技术支持': 100,
            '顾问': 100,
            '助理': 100,
            '文员': 100,
            '秘书': 100,
            '前台': 100,
            '招商': 100,
            '保险': 100,
            '房产': 100,
            '中介': 100,
            '经纪人': 100,
            '督导': 100,
            '门店': 100,
            'product manager': 100,
            'program manager': 100,
            'project manager': 100,
            'marketing': 100,
            'sales': 100,
            'presales': 100,
            'consultant': 100,
            'recruiter': 100,
        },
        # 标题弱负向：扣分但不清零
        'title_penalty_keywords': {
            '资深': 40,
            '高级': 40,
            '专家': 40,
            '3年以上': 45,
            '5年以上': 45,
            '负责人': 35,
            '架构师': 35,
            '前端': 30,
            '运维': 32,
            'linux运维': 34,
            'sre': 34,
            'devops': 34,
            '平台工程': 26,
            '实施': 24,
            '交付': 20,
            '技术支持': 26,
            'senior': 40,
            '27届': 20,
            '2027届': 20,
            '26届': 25,
            '2026届': 25,
            '校招': 15,
        },
        # 标题强正向：Agent 应用开发主线
        'title_strong_keywords': {
            'ai agent开发': 97,
            'ai agent 开发': 97,
            'aiagent': 96,
            'ai agent': 96,
            'agent开发': 96,
            'agent应用': 96,
            'agent工程师': 95,
            'agent平台': 93,
            'agent': 90,
            # Java/Python 都能做的平台类岗位（Agent/大模型平台后端）
            'ai平台': 90,
            'ai中台': 88,
            '大模型平台': 92,
            '智能体开发': 96,
            '智能体应用': 95,
            '多智能体': 94,
            '智能体': 94,
            'ai应用开发': 96,
            'ai应用工程师': 95,
            'ai应用': 92,
            '大模型应用开发': 96,
            '大模型应用': 94,
            'llm应用开发': 94,
            'llm应用': 92,
            'rag工程师': 93,
            'rag开发': 93,
            '检索增强': 90,
            'rag': 93,
            'ai工作流': 94,
            '工作流开发': 92,
            '工作流工程师': 91,
            'mcp': 92,
            'langgraph': 94,
            'langchain': 93,
            'llamaindex': 90,
            'vibe coding': 92,
            'vibecoding': 92,
            'ai coding': 91,
            'ai原生': 91,
            'ai native': 91,
            'ai开发': 90,
            'ai工程师': 88,
            'ai落地': 90,
            'agent实习': 92,
            'ai应用实习': 93,
            'ai实习': 86,
            'prompt工程师': 86,
            '提示词工程师': 86,
            'python工程师': 60,
            # 英文 / 跨国企业常见写法
            'ai agent engineer': 97,
            'agent engineer': 95,
            'agentic': 94,
            'genai engineer': 96,
            'genai': 93,
            'llm engineer': 94,
            'ai engineer': 92,
            'ai application engineer': 95,
            'applied ai': 94,
            'ai developer': 92,
            'ai platform engineer': 91,
            'forward deployed': 92,
            'fde': 88,
            # ---- Java 后端 / 全栈（与 Agent 方向并行投递） ----
            # 注意：'java' 会命中 'javascript'，core.py 匹配前已剔除 js/ts 字样
            'java开发': 93,
            'java开发工程师': 95,
            'java工程师': 91,
            'java后端': 95,
            'java后端开发': 96,
            'java研发': 92,
            'java实习': 90,
            'java软件开发': 94,
            'java': 88,
            '后端开发工程师': 89,
            '后端开发': 88,
            '后端工程师': 88,
            '服务端开发': 88,
            '全栈开发': 93,
            '全栈工程师': 92,
            '全栈': 90,
            'full stack': 92,
            'fullstack': 91,
            'full-stack': 92,
        },
        # 标题中等信号：单靠它进不了阈值，需要 JD 一起支撑
        'title_medium_keywords': {
            'ai': 40,
            '大模型': 42,
            'llm': 42,
            'mcp': 66,
            'workflow': 58,
            '工作流': 58,
            '知识库': 56,
            'prompt': 50,
            '提示词': 50,
            '自动化': 40,
            '提效': 40,
            '工具': 40,
            'python': 40,
            'java': 40,
            '后端': 34,
            '全栈': 36,
            '开发实习': 66,
            'codex': 54,
            'claude code': 58,
            'cursor': 52,
            '解决方案': 34,
            'saas': 34,
        },
        # JD 正文强正向：Agent 技术栈
        'detail_infra_keywords': {
            '智能体': 8,
            '多智能体': 7,
            'ai agent': 8,
            'agent': 7,
            'subagents': 6,
            'rag': 7,
            '检索增强': 6,
            '知识库': 6,
            '检索': 5,
            '重排': 5,
            '向量': 4,
            'embedding': 5,
            'mcp': 7,
            'function calling': 6,
            '工具调用': 6,
            '工作流': 6,
            'workflow': 6,
            'langchain': 5,
            'langgraph': 5,
            'llamaindex': 4,
            '提示词工程': 5,
            'prompt工程': 5,
            '上下文工程': 5,
            'langfuse': 3,
            '可观测': 3,
            'trace': 3,
            'pgvector': 4,
            '向量数据库': 4,
            'ai原生': 6,
            'vibe coding': 7,
            'claude code': 6,
            'cursor': 5,
            'codex': 5,
            'llm': 6,
            'genai': 7,
            'agentic': 7,
            'multi-agent': 6,
            'orchestration': 5,
            'prompt engineering': 5,
            'tool calling': 6,
            'vector database': 4,
            'crewai': 4,
            'autogen': 4,
            'langsmith': 3,
            'openai': 4,
            'anthropic': 4,
        },
        # JD 正文辅助正向：工程落地能力
        'detail_support_keywords': {
            'python': 8,
            'api': 3,
            '调试': 5,
            '部署': 5,
            '上线': 5,
            '云服务器': 4,
            '自动化': 5,
            '提效': 5,
            '工具开发': 6,
            '代码生成': 5,
            '需求理解': 4,
            '工程实现': 5,
            '效果评测': 5,
            '测试集': 4,
            'a/b': 3,
            '业务闭环': 4,
            '可复用组件': 3,
            '迭代': 3,
            '开源': 2,
            'github': 3,
            'docker': 3,
            '每周到岗': 5,
            '每周4天': 5,
            '每周5天': 5,
            '3个月': 4,
            '长期实习': 4,
            '可转正': 3,
            'fastapi': 5,
            'rest api': 3,
            'postgres': 4,
            'redis': 3,
            'kubernetes': 3,
            'aws': 4,
            'gcp': 4,
            'azure': 3,
            'ci/cd': 3,
            'microservices': 3,
        },
        # JD 正文：后端技术栈。Java / 全栈岗的 JD 不会出现 Agent 词，
        # 只靠 detail_support 那 12 分撑不到阈值，所以单开一桶（上限 20）
        'detail_backend_keywords': {
            'java': 6,
            'spring boot': 6,
            'springboot': 6,
            'spring cloud': 5,
            'springcloud': 5,
            'mybatis': 5,
            'mysql': 5,
            'redis': 5,
            'kafka': 5,
            'rabbitmq': 4,
            'rocketmq': 4,
            '微服务': 6,
            '分布式': 5,
            '高并发': 5,
            '消息队列': 4,
            'jvm': 5,
            '索引': 4,
            '缓存': 4,
            '事务': 3,
            'elasticsearch': 4,
            'mongodb': 3,
            'nginx': 3,
            'tomcat': 3,
            'sql': 4,
            'restful': 4,
            'mvc': 3,
            '中间件': 4,
            '多线程': 4,
            'linux': 3,
            'docker': 3,
            '接口设计': 3,
            '服务端开发': 4,
        },
        # JD 正文负向：算法训练 / 非应用方向
        'detail_negative_keywords': {
            'c++': 16,
            'c语言': 16,
            'cpp': 16,
            'golang': 14,
            'go语言': 14,
            'rust': 12,
            '算法': 14,
            '机器学习': 12,
            '深度学习': 12,
            '微调': 14,
            '预训练': 16,
            '训练': 14,
            '推荐系统': 12,
            '搜索算法': 12,
            '多模态算法': 12,
            'cv': 10,
            '数据标注': 12,
            '值班': 12,
            'on-call': 12,
            '运维': 10,
            'k8s运维': 12,
            '3年以上': 18,
            '5年以上': 22,
            '独立带团队': 18,
            'fine-tuning': 14,
            'pretraining': 16,
            'reinforcement learning': 14,
            'computer vision': 12,
            'recommendation system': 12,
        },
    },
}


def _deep_merge(base: dict, override: dict) -> dict:
    result = copy.deepcopy(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = _deep_merge(result[key], value)
        elif value is not None:
            result[key] = value
    return result


def _apply_legacy_compat(config: dict, user_config: dict) -> dict:
    legacy_top_level_to_nested = {
        'job_score_delay_base_ms': ('backend', 'job_score_delay_base_ms'),
        'job_score_delay_jitter_ms': ('backend', 'job_score_delay_jitter_ms'),
        'thread': ('frontend', 'thread'),
    }
    for old_key, (group, new_key) in legacy_top_level_to_nested.items():
        if old_key in user_config and user_config[old_key] is not None:
            config[group][new_key] = user_config[old_key]
    return config


def _normalize_resume_config(config: dict) -> dict:
    """把旧字段 frontend.resumeMatch 收敛到 frontend.resume。"""
    frontend = config.setdefault('frontend', {})
    resume = frontend.get('resume')
    if not isinstance(resume, dict):
        resume = copy.deepcopy(DEFAULT_USER_CONFIG['frontend']['resume'])
    else:
        resume = _deep_merge(DEFAULT_USER_CONFIG['frontend']['resume'], resume)

    legacy = frontend.pop('resumeMatch', None)
    if isinstance(legacy, str) and legacy.strip():
        legacy_keywords = [item.strip() for item in legacy.split(',') if item.strip()]
        existing = [keyword for keyword in (resume.get('match') or []) if keyword]
        resume['match'] = list(dict.fromkeys([*existing, *legacy_keywords]))

    if not isinstance(resume.get('match'), list):
        resume['match'] = []
    if not isinstance(resume.get('exclude'), list):
        resume['exclude'] = []

    frontend['resume'] = resume
    return config


def _sanity_check(config: dict) -> dict:
    """详情页回传依赖时间窗，时间窗必须大于详情等待时间，否则必然超时跳过。"""
    frontend = config.setdefault('frontend', {})
    try:
        detail_timeout = int(frontend.get('detailTimeout') or 0)
        timestamp_timeout = int(frontend.get('timestampTimeout') or 0)
    except (TypeError, ValueError):
        return config
    if detail_timeout and timestamp_timeout <= detail_timeout:
        frontend['timestampTimeout'] = detail_timeout + 15000
    return config


def _load_raw_user_config():
    config_path = 'user_config.json'
    if os.path.exists(config_path):
        with open(config_path, 'r', encoding='utf-8') as f:
            user_config = json.load(f)
        if isinstance(user_config, dict):
            return user_config
    return {}


def load_user_config():
    config = copy.deepcopy(DEFAULT_USER_CONFIG)
    user_config = RAW_USER_CONFIG
    if isinstance(user_config, dict) and user_config:
        config = _deep_merge(config, user_config)
        # 打分词表**整表替换**：deep merge 是逐键合并，用户没写的键会保留默认值，
        # 于是旧词残留（实测 "ai产品" 82 分留在表里 → "AI产品经理" 这类岗位照样被投）。
        # 用户给了完整词表，就该以用户的为准；
        # 但整张表缺失的新维度（例如后加的 title_nondev_keywords）要从默认值补上，
        # 否则老配置会静默丢掉这一层过滤。
        if isinstance(user_config.get('scoring'), dict):
            user_scoring = copy.deepcopy(user_config['scoring'])
            for key, value in DEFAULT_USER_CONFIG['scoring'].items():
                if key not in user_scoring:
                    user_scoring[key] = copy.deepcopy(value)
            config['scoring'] = user_scoring
        config = _apply_legacy_compat(config, user_config)
    config = _normalize_resume_config(config)
    config = _sanity_check(config)
    return config


RAW_USER_CONFIG = _load_raw_user_config()
USER_CONFIG = load_user_config()


class Config:
    resume_name = USER_CONFIG['resume_name']
    think_model = USER_CONFIG['think_model']
    chat_model = USER_CONFIG['chat_model']
    introduce = USER_CONFIG['introduce']
    character = USER_CONFIG['character']
    tags = USER_CONFIG['tags']

    job_score_delay_base_ms = USER_CONFIG['backend']['job_score_delay_base_ms']
    job_score_delay_jitter_ms = USER_CONFIG['backend']['job_score_delay_jitter_ms']

    title_block_keywords = USER_CONFIG['scoring']['title_block_keywords']
    title_nondev_keywords = USER_CONFIG['scoring'].get('title_nondev_keywords', {})
    title_nondev_exceptions = USER_CONFIG['scoring'].get('title_nondev_exceptions', [])
    title_penalty_keywords = USER_CONFIG['scoring']['title_penalty_keywords']
    title_strong_keywords = USER_CONFIG['scoring']['title_strong_keywords']
    title_medium_keywords = USER_CONFIG['scoring']['title_medium_keywords']
    detail_infra_keywords = USER_CONFIG['scoring']['detail_infra_keywords']
    detail_support_keywords = USER_CONFIG['scoring']['detail_support_keywords']
    detail_backend_keywords = USER_CONFIG['scoring'].get('detail_backend_keywords', {})
    detail_negative_keywords = USER_CONFIG['scoring']['detail_negative_keywords']

    frontend = USER_CONFIG['frontend']
    backend = USER_CONFIG['backend']
    scoring = USER_CONFIG['scoring']
    resume = USER_CONFIG['frontend']['resume']
    llm = USER_CONFIG.get('llm', DEFAULT_USER_CONFIG['llm'])

    @classmethod
    def get_default_introduce(cls):
        return cls.introduce

    @classmethod
    def get_client_config(cls):
        return {
            'introduce': cls.get_default_introduce(),
            'character': cls.character,
            'tags': cls.tags,
            'frontend': cls.frontend,
        }
