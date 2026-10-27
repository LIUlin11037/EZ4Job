# goodjob

一个面向 Boss 直聘的轻量自动投递简历项目，采用“浏览器脚本 + 本地 Python 后端”的组合方式。

当前主线已经收敛为：
- 单简历
- 单方向投递
- 规则筛选岗位
- 固定打招呼
- 收到 Boss 新消息后直接发送简历
- 默认不继续自动聊天

它不是多招聘平台框架，不是复杂多轮自动聊天助手，也不是招聘 SaaS。

## 适合什么方向

当前仓库模板默认更适合这些岗位：
- AI 产品工程师
- AI 应用工程师
- AI Agent / 智能体
- 工作流工程师
- AI Native / Vibe Coding / 大模型应用落地类岗位

当前评分逻辑的核心偏好：
- 标题只做弱信号
- JD 正文里的真实技术要求、工具链、工作流是强信号
- 更关注 Claude Code、Cursor、Codex、Agent、Workflow、Prompt，以及需求到调试部署上线的闭环能力

不适合作为主目标方向的岗位：
- 传统算法训练 / 模型研发
- 传统运维 / SRE / DevOps
- 销售 / 运营
- 纯 C/C++/Go 底层岗

## 现在能做什么

当前主链能力：
- 在 Boss 直聘岗位列表里轮换搜索关键词
- 对岗位做规则打分
- 达到阈值后自动打招呼
- 收到 Boss 新消息后直接发送指定简历
- 连续多轮没有新岗位时自动切换关键词继续挂机
- 遇到超时、详情异常、打招呼异常时自动恢复

## 演示视频

- B 站演示视频：https://www.bilibili.com/video/BV1MyX6BFEp3

## 项目结构

- `main.py`：FastAPI 后端入口
- `core.py`：规则评分主逻辑 + 遗留聊天能力
- `config.py`：配置加载与岗位评分配置
- `web_script.js`：Boss 页面 Tampermonkey 脚本
- `user_config.example.json`：用户配置模板
- `resume-example.md`：简历模板
- `PROJECT_MEMORY.md`：长期项目背景与关键决策
- `DEV_LOG.md`：开发演进记录

## 快速开始

### 1. 安装依赖

```bash
pip install -r requirements.txt
```

### 2. 准备用户配置

```bash
cp user_config.example.json user_config.json
```

首次最少只需要改这些字段：
- `introduce`：固定打招呼语
- `tags`：搜索关键词列表
- `frontend.resume.match`：要发送的那份简历的名字关键字
- `frontend.thread`：投递阈值

### 3. （可选）准备简历文件

```bash
cp resume-example.md resume.md
```

说明：
- 当前自动投递主链并不依赖 `resume.md` 做岗位打分
- 它主要用于你自己管理简历内容，或保留给遗留接口扩展使用

### 4. 启动后端

```bash
python main.py
```

Windows 下也可以直接双击：

```text
start_backend.bat
```

### 5. 部署浏览器脚本

把 `web_script.js` 内容粘贴到 Tampermonkey 中，然后打开 Boss 直聘页面即可。

## 最小使用路径

1. 复制 `user_config.example.json` 为 `user_config.json`
2. 修改：
   - `introduce`
   - `tags`
   - `frontend.resume.match`
   - `frontend.thread`
3. 启动后端 `python main.py`
4. 浏览器装入 `web_script.js`
5. 打开 Boss 直聘页面测试

## 配置说明

当前推荐把所有用户差异化内容集中维护在 `user_config.json`。

普通用户主要改：
- `introduce`
- `tags`
- `frontend.resume.match`
- `frontend.thread`

更细的岗位评分规则内置在 `config.py` 的默认值里，普通用户不用从零写。需要微调时，把 `scoring` 整段复制进 `user_config.json` 再改——**一旦写了 `scoring`，就会整表替换默认词表**。

### 顶层字段
- `resume_name`
- `think_model`
- `chat_model`
- `introduce`
- `character`
- `tags`

### 招呼语（`introduce`）怎么写

- **控制在 160 字内**：手机端首屏大约 3 行，再长 HR 就不读了；超过 180 字脚本会在面板里提示
- 顺序建议：`身份 + 方向` → `一个项目钩子（技术点不超过 4 个）` → `一个数字` → `明确动作`
- 只留一个最亮的量化结果，别把 token 降幅、成本、准确率全堆上
- 结尾要有动作（“方便发您简历吗”），不要用逗号断在半句上

### `frontend`
浏览器端运行参数：

投递节奏与筛选
- `thread`：投递阈值，`score >= thread` 才打招呼
- `onlyGreet`：只打招呼，不继续自动聊天
- `manualFilterWaitMs`：每轮搜索后留给你手动选筛选条件的时间
- `roundRestartDelayMs`：轮次之间的缓冲
- `maxEmptyRounds`：连续多少轮没新岗位后**切换关键词**（注意：不是停止）

停止条件（0 表示不限制）
- `maxGreetsPerDay`：**当天累计**最多打招呼多少个（默认 130）。Boss 平台硬上限 150 沟通/天，留 20 余量
  （脚本只统计自己发起的沟通，手动打的算不到，所以必须留余量）
- `maxGreetsPerRun`：本次运行最多多少（默认 0 = 不限，日常靠日限兜底）
- `maxRunHours`：本次最多跑多少小时（默认 6）
- `maxRounds`：最多跑多少轮（默认 0 = 不限）
- 达到任一上限后程序进入**暂停**（不关页面），面板提示原因

关于日限：

- 计数同时存在两处：`localStorage.__zhipin_daily_greet`（跨重启有效、跨天归零）**和**后端 `GET /greet-stats`
  （按 `job_actions.jsonl` 统计当天 `chat_open_requested`），启动时取两者较大值校准
- 点「继续」只重置本次运行计数，不会重置当日计数
- 平台返回“上限 / 次数 / 限制 / 频繁”类提示时，脚本**立刻暂停**，不会继续消耗剩余额度
- 连续 5 次被平台拒绝也会暂停，并提示疑似触到限额或风控

除此之外，程序默认是**无限挂机**的：轮次结束只会换关键词继续，不会自己停。

详情页与打招呼（超时相关，改之前先看下面的说明）
- `detailTimeout`：单个岗位详情最多等多久
- `detailRetry`：详情超时后重试几次
- `detailReadyTimeout`：详情页等关键 DOM 渲染出来的上限
- `detailOpenWaitMs`：打开详情标签后先等多久再开始收消息
- `timestampTimeout`：跨标签页的时间窗
- `greetTimeout`：打招呼回执超时

回复后自动发简历
- `autoSendResumeOnReply`：独立开关，**和 `onlyGreet` 无关**
- `chatPollIntervalMs`：投岗位期间每隔多久去聊天页看一次新回复（默认 3 分钟）
- `chatPollTimeout`：单次检查最多等多久，超时就继续投岗位（默认 60 秒）

预加载
- `preloadScrollPixels` / `preloadScrollWaitMs`：预加载时每轮下滑距离与等待
- `preloadStableRoundsLimit` / `preloadMaxRounds`：连续多少轮无增长结束 / 最多滑多少轮
- `preloadMaxJobs`：**已加载岗位数上限**，建议 80~120

### `frontend.resume`（指定简历）

脚本点「发送简历」后，会先切到附件简历页签，再按关键字从列表里挑你指定的那份。

- `name`：最重要的一份，排在第一优先匹配
- `match`：关键字数组，按顺序匹配，命中即选中
- `exclude`：明确不发的简历，默认排除 `在线简历` / `模板简历`（就是平台自动生成的模板）
- `preferAttachment`：优先切到「附件简历」页签
- `strict`：`true` 时匹配不到就**放弃发送**并写日志，不会退回去发默认模板；`false` 才允许按序号兜底
- `followUpText`：发完简历补一句，置空则不补

想看脚本到底看到了哪些简历，看聊天页左下角的 `简历列表:` 那行日志，它会打印 Boss 弹窗里每一项的文本。

### 回复后自动发简历是怎么跑的

1. 投岗位期间，每隔 `chatPollIntervalMs` 打开一次聊天页（不会打断投递，等它跑完再继续下一个岗位）
2. 聊天页只处理**有未读红点**的会话，逐条判断：
   - 最新一条是我发的 → 跳过
   - 已经发过简历（页面出现“点击预览附件简历”，或本地有发送记录）→ 跳过
   - 还没发过 → 拿岗位详情 → 走 `resume` 配置选简历 → 发送 → 校验回执
3. 发完写一条记录到 localStorage，30 天内不会对同一个人重复发（轮询会反复重载页面，靠这个去重）
4. 发送失败的联系人本次运行不再重试，避免反复弹窗；重启脚本可重试
5. 全流程不调用大模型聊天，发完就结束

注意：
- 这个功能**不受 `onlyGreet` 影响**。`onlyGreet` 现在只决定“轮次结束后是否打开聊天页做代聊天”，自动发简历是单独的开关
- 如果日志出现 `简历未发送：未找到指定简历`，说明 `resume.match` 和弹窗里的简历名对不上，看 `简历列表:` 那行改关键字
- 没有“已读但没回复”的会话不会被处理，只处理有未读红点的

### `backend`
- `job_score_delay_base_ms`：每次打分的人为延迟，纯本地请求，没必要给太大
- `job_score_delay_jitter_ms`：延迟抖动

### `llm`（大模型复核，可选）

规则负责“一眼就不对”的岗位，模型负责“规则拿不准”的岗位：规则判 0 分的不调用模型，省 token。

- `enabled`：是否启用
- `mode`：
  - `veto`：只复核已过阈值的岗位，只允许否决（最省钱）
  - `hybrid`：非硬拦截的岗位都让模型看一眼，既能否决也能捞回（推荐）
  - `always`：全部复核
  - `off`：关闭
- `base_url` / `model`：OpenAI 兼容接口。默认 DeepSeek：`https://api.deepseek.com` + `deepseek-flash`
- `thinking`：**必须为 `false`**。判岗不需要思维链，开着会多烧几倍输出 token
- `api_key`：也可以不写在这里，改用环境变量（`api_key_env`，默认 `DEEPSEEK_API_KEY`）
- `timeout_s` / `max_tokens` / `jd_max_chars`：超时、输出上限、JD 截断长度
- `max_calls_per_run`：单次启动最多调用多少次，防跑飞
- `target_profile` / `exclude_rules`：喂给模型的“我是谁 / 不要什么”，改这里比改词表更有效

模型只返回 JSON：`apply` / `score` / `role_type` / `language` / `reason`。其中
`role_type` 必须是 `agent_dev` 或 `ai_dev`、且 `language` 不能是 `other`，否则即使模型说 apply 也会被否决。

自检命令：

```bash
python llm_judge.py "AI Agent 产品经理" "负责需求分析与 PRD，不写代码"
python llm_judge.py            # 只看当前是否启用、用的哪个模型
curl http://127.0.0.1:8000/llm-status
```

成本参考（DeepSeek Flash，2026-10 价格）：一次判岗约 780 输入 + 50 输出 token，
1000 个岗位约 ¥1（空闲时段）~¥2（高峰时段）。规则拦截掉的岗位不产生调用。

### `scoring`
岗位评分规则主要分成：
- 标题强负向词（命中直接 0 分，不投）
- 职能门控词 `title_nondev_keywords`（命中直接 0 分：产品/市场/运营/售前/设计/HR…）
- 标题弱负向扣分词
- 标题强匹配词
- 标题中匹配词
- 正文强正向词
- 正文辅助正向词
- 正文负向扣分词

几条关键约束：
- `min_title_score`（默认 86）：标题分不够的一律压到阈值以下。只命中“web开发 / python / 后端”这类泛化词，哪怕 JD 写了 Agent 也不投
- 中英文词表都覆盖：`AI Engineer` / `GenAI Engineer` / `Forward Deployed Engineer` 等英文标题可直接命中，
  `Machine Learning Engineer` / `AI Product Manager` / `Solutions Engineer` 会被挡掉
- 标题命中方向词但 JD 里一点技术要求都没有（标题党）→ 封顶 80
- `title_nondev_exceptions`：先剔除这些短语再走职能门控，避免“一级市场/二级市场”被当成营销岗

当前推荐理解方式：
- 标题只做快速筛选
- JD 正文里的真实技术要求才是主要判断依据
- 规则不确定的交给 `llm` 复核

### 关于两个超时参数

详情页只有在 `timestampTimeout` 这个时间窗内才会把岗位信息回传，所以：

```text
timestampTimeout  >  detailTimeout
```

反了的话，搜索页每个岗位都会白等一次超时再跳过。`config.py` 启动时会做这个自检，发现反了会自动调大并告警，但最好直接把 `user_config.json` 改对。

前端启动时会优先请求后端 `/client-config`，统一读取：
- `introduce`
- `tags`
- `frontend`（含 `resume`）

## 关于大模型依赖

当前主链在未安装 `ollama`、也没配大模型 API 的情况下也能运行，覆盖这些能力：
- 固定 `tags`
- 固定 `introduce`
- 规则岗位评分
- 收到新消息后直接发简历

想让“岗位判断”更准，配 `llm` 段接一个 OpenAI 兼容接口（默认 DeepSeek）即可，
`ollama` 与它是两套东西：前者只服务 `/reply`、`/is-need-resume`、`/is-need-works` 这些遗留接口，
后者只服务 `/get-job-score` 的复核。

也就是说：
- `ollama` 属于遗留能力，不是主链运行前提
- `llm` 属于可选增强，不配也能跑，配了能明显少投错

## 仓库说明

- `user_config.json`、`resume.md`、日志文件等本地文件默认不进入仓库
- `user_config.example.json` 是公开模板，不建议直接提交真实配置
- 当前公开仓库优先服务中文用户，因此默认中文说明

## 历史说明

这个项目在个人使用阶段曾演化出一版“双简历 / 双方向自动路由”的复杂版本。

那版代码已经单独归档到分支：
- `archive/double-routing-chaos`

该分支仅供历史参考，不推荐新用户直接从那里开始。

## 后续方向

当前更合理的继续方向是：
- 保持用户配置外置化
- 保持岗位规则可调
- 继续优先保证 Boss 自动化链路稳定
- 不把主线重新做回复杂双路由或重度模型依赖版本
- 继续让评分更贴近 JD 正文真实技术要求，而不是岗位名字字面词
