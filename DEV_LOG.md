# 开发日志

> 这份文件主要记录 `goodjob` 这次开源化整理与后续工程演进过程。新会话接手时，可先读 `PROJECT_MEMORY.md`，再读这份 `DEV_LOG.md`。

## 2026-10-26（五）只沟通不发招呼：输入框没真正写进去

### 现象

修复 ReferenceError 后跑了一轮，`job_actions.jsonl` 统计：

```
15:00 之后：greet_queued 22，greet_sent 10（3~7 秒完成），无一超时
但这 10 次 greet_sent 全是 verified: false
```

用户在 Boss 页面看到的正是“已沟通，但对方没收到问候语”。

### 结论

超时问题已解决（3~7 秒回执），但**消息没有真正发出去**。

### 根因

原 `sendMsg()` 只有一行：

```js
ipt.innerText = text;
await sleep(600);
btn.click();
```

`#chat-input` 是 contenteditable 编辑器，直接改 `innerText` 不会触发它的 `beforeinput` / `input` 事件，
Boss 内部状态仍然是“空输入”。于是：

- 发送按钮虽然能点到，但应用认为没有内容 → 不发送，或按钮处于 disabled 状态；
- 输入框里的文字看起来是有的（视觉上有），所以从界面上不容易发现。

这也是“只沟通不发送打招呼”的直接原因，跟招呼长度、网络都无关。

### 修复（`sendMsg` 重写）

- 新增 `fillChatInput()`：
  - 优先 `document.execCommand('insertText')`（会触发编辑器的原生 input 流程）
  - 失败时退回 `innerText` + 手动派发 `InputEvent('input')` / `change`，并把光标移到末尾
  - 支持 textarea/input（`value + input 事件`）
- 发送前先断言输入框非空，空则直接报错，不再“假装发了”
- 发送方式：按钮可用就点按钮，不可用（`disabled`）就派发 Enter 键盘事件
- 发送后校验三选一：输入框被清空 / 气泡出现（`.item-myself`）/ 两者的 2.5 秒窗口
- 首次不成功则换 Enter 再试一次，仍不成功才抛错（错误信息会进 `greet_message_failed.reason`）
- `sayHi()` 的 `verified` 改为复用发消息后的二次校验（1.5 秒），失败会写进 `greet_sent.verified`

### 补充：用户反馈“也有成功发送打招呼的”

说明发送不是 100% 失败，而是**时好时坏**——这正好符合“直接改 contenteditable 的 innerText”的行为特征：
编辑器的框架有时能感知到（后续别的事件顺手同步了），有时感知不到（点发送等于空发）。

所以又补了三件事：

1. `findMyMsg()` 忽略空白差异，并且先找 `.item-myself`，找不到再退回所有 `.message-content .text`
   —— 之前 `verified: false` 很可能是选择器/空白差异造成的**误报**，而不是真的没发
2. `sendMsg()` 返回 `confirmed`（`bubble` 气泡确认 / `cleared` 输入框被清空），写进
   `greet_message_sent.confirmed` 和 `greet_sent.confirmed`，可以区分“确定发出”和“推测发出”
3. 发送失败时输出 DOM 现场快照 `describeChatDom()`：
   `自己N/对方N/文本N/输入框残留N字/末条「...」`，直接判断是没写进去、按钮没生效，还是选择器不对

另外一个坑：打招呼页没有 `logger`（只有聊天页才创建），失败分支里写诊断日志会再抛一次
`Cannot read properties of null`，把真实错误盖掉。已加判空。

### 招呼语压缩（233 → 162 字）

原招呼语 233 字、结尾断在逗号上，信息密度有余但可读性差。定稿为：

> 您好！我是 2029 届本科生，主攻 Python + Agent。用 LangGraph 独立做过「Agent + RAG」调研系统：
> 四角色编排、MCP 工具按需装载、检索侧混合召回 + 重排，引用能核到页码，自建评测集单题成本 ¥0.26，
> Java 后端也能写。找 AI 应用 / Agent 开发实习，方便发您简历吗？

压缩原则：前置身份、技术点 8→4、数字只留一个（¥0.26）、删工具名与过程细节、补明确的行动请求。
另在脚本启动时加了「>180 字提示」，`readme` 补了写作四点。

### 验证方法

下次运行看 `job_actions.jsonl`：

- `greet_sent.confirmed` = `bubble` → 确定发出；= `cleared` → 应用已受理（可信）
- `greet_sent.verified` = false 但 confirmed 有值 → 只是页面没刷新出气泡，不是失败
- 若出现 `greet_message_failed`，`reason` 里会带现场快照，可直接定位问题

## 2026-10-26（七）自动发简历被“继续沟通”挡住

### 背景

打招呼修好后，用户问“HR 回复自动发简历到底能不能做到”。翻日志发现链路其实已经跑到了发简历这一步：

```
15:22:57  job_decision_consumed | AI应用开发
15:22:58  resume_skip_no_jobinfo | 按钮为 [继续沟通]，疑似网申岗位
```

`resume_skip_no_jobinfo` 共 3 次，全是同一个原因。

### 根因

详情页 `readJobInfo()` 的判定是：

```js
if (actionText.indexOf('立即沟通') === -1) skip = '疑似网申岗位'
```

但**已经打过招呼的岗位，按钮文案会变成“继续沟通”**。而聊天页发简历的前提就是“我们聊过”，
所以这个判定等于把所有该发简历的场景全部拦掉——这是个必然触发的逻辑错误。

### 修复

1. `readJobInfo()` 允许 `立即沟通` 和 `继续沟通` 两种文案，只有真正不是沟通按钮（网申/投递简历）才 skip
2. 聊天页发简历只要求 `title` + `detail`，不再因为 `skip`（缺聊天链接等）中断
3. 新增简历弹窗现场快照 `describeResumeUi()`：
   `工具栏[…按钮文案…] 面板[命中的选择器] 简历项N`，失败时写进日志和 `reason`
4. 新增两个油猴菜单入口（`@grant GM_registerMenuCommand`，需重新粘贴脚本）：
   - 「① 检查简历弹窗（不发）」：`sendResume(dryRun=true)`，只打开弹窗、打印候选和会选中哪个，
     不点确认，**不会真的发出去**；任何已有会话都能测，不需要等 HR 回复
   - 「② 真的给当前会话发简历」：真实发送，用于最后确认
5. 修了手动测试时 `logger` 为 null 会抛错的问题（`sendResume` 内部要写日志）

### 现在整条链路

```
投岗位 → 每 3 分钟 → 开聊天页 → 扫未读红点 → 拿岗位详情（继续沟通也算）
     → resume.match 选附件简历 → 发送 → 校验回执 → localStorage 去重
```

### 仍需注意

- **BOSS 上必须已经上传过附件简历**，否则池子里只有“在线简历”，会被 `exclude` 排除 → 严格模式直接不发
- 简历弹窗的选择器是按 `.panel-resume / .resume-list` 推断的，没在真实弹窗上验证过；
  失败时日志里的现场快照可以直接定位

## 2026-10-26（八）聊天页没拉配置 + 简历弹窗识别失败

### 真实日志（油猴菜单 ① 试运行）

```
未发现附件简历页签，按当前面板内容继续
简历列表: (未识别到简历列表)
目标简历关键字: (未配置)
...现场: 工具栏[发简历|换电话|换微信] 面板[.dialog-container,.dialog-wrap] 简历项0
```

### 问题 1：聊天页从来没拉过 /client-config（致命）

`applyFrontendOptions` 只写在 `__search.main()` 里，而每个标签页是独立的 JS 上下文。
聊天页的 `OPTIONS.resume` 一直是最初的空数组 → `keywords` 为空 → 严格模式判定“未配置” → 直接放弃。

也就是说：**就算 HR 回复了、链路走到发简历，也一定失败**。这次手动测试提前暴露了它。

修：
- 把配置应用逻辑提到模块作用域 `applyFrontendOptions(frontend, log)`，搜索页/聊天页共用
- `__chat.main()` 启动时先 `GET /client-config`，应用后再进业务分支，日志里能看到“简历策略：指定关键字 […]”

### 问题 2：简历弹窗结构没命中

工具栏能正确找到「发简历」，但点击后弹窗里：
- 没有“附件简历”页签
- `li / .resume-item / [class*=resume-card]` 一个都没匹配到

修：
- `collectResumeItems()` 增加三条取项路径：`input[type=radio/checkbox]` 所在 label → 常见列表类名 → 兜底按文本匹配（含 `.pdf` / 在线简历 / 附件简历 的叶子节点）
- 新增 `dumpPanelStructure()`：输出弹窗内前 45 个节点的 `标签.class「文本」`，识别不到简历时打印，用来对着真实 DOM 调选择器

### 第二轮真机测试

```
目标简历关键字: <简历名关键字>       ← 配置已通（上一次是后端没启动）
弹窗结构: 无可见弹窗                  ← 但紧接着现场快照又说命中 .dialog-container
```

两句话自相矛盾，说明**弹窗是异步渲染的**：800ms 时读不到，1 秒多之后才出现。

修：

- 新增 `waitResumePanel()`：轮询最多 8 秒，直到弹窗出现或列表可读，不再固定 sleep
- 列表收集改为最多 8 次重试（每次 400ms）
- `visiblePanels()` 按文本长度升序：小面板（真弹窗）优先，整页容器排后面
- `dumpPanelStructure()` 升级：输出前两个面板的结构，并带上**页面 iframe 数量**
  （Boss 若把弹窗渲染在 iframe 里，主文档查不到，必须知道）
- 试运行时无条件打印结构快照
- 菜单命令执行前先 `reloadConfig()`，兼容“先开页面、后启动后端”
- 新增 `reloadConfig()` 作为配置重载兜底

### 待确认

再跑 ①，把 `[试运行] 结构:` 那行贴出来，据此确定真正的简历项选择器。
若结构里只有“在线简历”，说明 BOSS 上没上传附件简历。

## 2026-10-26（九）简历链路真机跑通

### 结果

用户真机试运行（`① 检查简历弹窗（不发）`）成功：

```
选择简历: 简历A.pdf 更新于 2026.10.25 22:46 (name:<关键字>)
[试运行] 弹窗内容: 请选择要发送的简历 / 已上传附件
  简历A.pdf 预览
  简历B.pdf 预览
  简历C.pdf 预览
[试运行] 本应发送: 简历A.pdf (name:<关键字>)
✅ 链路正常，本应发送：简历A.pdf（name:<关键字>）
```

三份附件简历里，按 `resume.name` 的关键字精确命中了目标那一份，没有误选另外两份。

### 关键修复回顾

这条链路一共卡了四处，按发现顺序：

1. `onlyGreet: true` 让聊天页永远打不开（整块发简历逻辑是死代码）
2. `sayHi()` 里 `logAction` 未定义 → 打招呼永远超时
3. 详情页把“继续沟通”当网申岗位 → 该发简历的场景全被跳过
4. 聊天页没拉 `/client-config` + 弹窗异步渲染读太早 → 关键词为空、简历项 0

### 顺手加固

`findConfirmBtn()` 增加文案兜底：类名匹配不到时，按 `发送 / 确认 / 确定 / 发送简历` 找按钮，
避免 Boss 改类名后卡在最后一步。

### 下一步

用「② 真的给当前会话发简历」在**真心想投的会话**上做一次真实发送，
确认 `job_actions.jsonl` 里出现 `resume_sent` 且 `verified: true`，
之后再交给自动轮询即可。

## 2026-10-26（十）加停止条件：原来永不停止

### 背景

用户问“这个什么时候会停”。核对代码发现：`handleRoundExhausted()` 的两个分支最后都是 `startRound()`，
`maxEmptyRounds` 只是“换关键词继续”，**程序根本不会自己停**。

能停的只有：手动点暂停、关页面、关浏览器、后端挂掉（前端继续跑但接口全失败）。
`llm.max_calls_per_run=400` 也只是停止调用模型，规则仍会继续投。

### 风险

- Boss 每日沟通数有上限，无限挂机容易撞上限甚至风控
- LLM 花费没有时长约束

### 修改

新增三个安全阀（0 = 不限制）：

| 字段 | 默认 | 含义 |
| --- | --- | --- |
| `maxGreetsPerDay` | 120 | **当天累计**最多打招呼（跨重启有效，Boss 约 150/天） |
| `maxGreetsPerRun` | 0 | 本次最多（0 = 不限，交给日限） |
| `maxRunHours` | 6 | 本次最长运行小时 |
| `maxRounds` | 0 | 最多轮数 |

用户补充：Boss 平台按天限流，投够约 150 个就不让投了。所以主限额改成**按天**：

- 计数存 `localStorage.__zhipin_daily_greet`，结构 `{date, count}`，跨天自动归零
- **重启脚本、刷新页面都不会清零**（原来按 run 计数，一天重启三次就能超 150）
- 点「继续」只重置本次运行计数，不动当日累计
- 日限设 120，留 30 给手动打招呼的量（脚本统计不到手动操作）

实现：

- `hitLimit()` 在 `loop()` 开头和 `startRound()` 开头各检查一次
- 触发后走 `stopProgram(reason)`：置 `pause = true`、面板打印原因、按钮变「继续」、写 `program_stopped` 动作日志
- 手动点「继续」会重置 `greetCount` 和 `runStartedAt`，否则一恢复就立刻再次撞上限
- 每次打招呼后打印 `本次已打招呼 N/80 个`

## 2026-10-26（十一）平台 biz_fail：温馨提示

### 现象

15:55 之后开始出现：

```
greet_queued  24
greet_sent    13
greet_queue_failed 11   |  Error: biz_fail:温馨提示
```

`biz_fail` 来自 `addToChatList()`：Boss 接口返回非 0，并带 `chatRemindDialog`（平台限制提示框）。

### 今日累计

```
greet_queued        123
chat_open_requested 112   ← 真实建立沟通
greet_sent           59
greet_queue_failed   11
```

**今天已经建了 112 个沟通，接近用户说的 150 日限**。失败集中在冲到 120 附近之后。

### 原代码的问题

只取了 `chatRemindDialog.title`（永远是“温馨提示”），正文全丢，等于没有诊断信息。

### 修改

1. 抓完整提示：`title + content/text/message/desc/subTitle/tips` 拼接，并把 dialog 原始 JSON 截 260 字写进日志与 `reason`
2. **熔断**：连续 5 次被平台拒绝 → `stopProgram()` 直接暂停，提示“疑似触到日限或风控”
3. **降速**：单次被拒后 sleep 3 秒再继续，避免连击加重风控
4. **`talked` 判定加固**：详情页按钮是“继续沟通”也算已聊过（原来只看 `dataset.isfriend`），
   避免对已沟通的岗位重复打招呼被平台拒

### 待确认

再跑一次看新的 `reason`，正文会明确是“今日沟通次数已达上限”还是“你已与对方沟通”。

## 2026-10-26（十二）限额触顶后的收尾加固

### 事实确认

用户反馈 Boss 提示“已沟通 120 次，还剩 30 次”（硬上限 150）。今天脚本统计到
`chat_open_requested = 112`，差 8 次属于口径差异（手动操作 / 平台计算方式）。

今天停止投递，用这段时间把遗留问题收干净。

### 本轮修改

1. **计数口径对齐平台**：`greetCount` / `dailyGreetCount` 只在 `chat_open_requested`
   （平台真的建立了沟通）之后累加。原来在调用前就加，失败也占额度。
2. **后端校准**：新增 `GET /greet-stats`，按 `job_actions.jsonl` 统计当天
   `chat_open_requested` / `greet_queue_failed`；前端启动时取 `max(localStorage, 后端)`。
   localStorage 会被清、换浏览器就丢，后端日志才是准的。
3. **日限 130**：150 硬上限留 20 余量（脚本统计不到手动打的招呼）。
4. **限额即停**：平台返回文案含 `上限 / 次数 / 限制 / 频繁 / 稍后再试` → 立刻 `stopProgram`，
   不再浪费剩余额度。
5. **熔断 + 降速**：连续 5 次被拒也停；单次被拒后 sleep 3 秒。
6. **已处理岗位持久化（7 天）**：`localStorage.__zhipin_processed_jobs` 存岗位 id，
   刷新页面/重启脚本不再重复投同一个岗位。原来只存在内存里，一刷新就全丢，
   容易对已沟通岗位重复打招呼被平台拒（也是 biz_fail 的来源之一）。
7. **打招呼页被拦截快速跳过**：`window.open` 返回 null 时立即跳过并提示允许弹窗，不再干等 25 秒。
8. **聊天页握手收紧**：`INTRODUCE` 等待 30s → 8s，拿不到招呼语就不在聊天页补发。

### 明天怎么开

1. 重启后端（日限、`/greet-stats` 都在 Python 侧）
2. 重新粘贴 `web_script.js`
3. 打开搜索页，面板应显示 `今日已在 Boss 建立沟通 0 个（脚本上限 130）`

## 2026-10-27（六）自动发简历：真实成功率是 0

### 统计

```
resume_sent（真实发送成功）: 0
resume_skip:                 7
  ├─ 3 次  按钮为[继续沟通]，疑似网申岗位   ← 昨天已修
  └─ 4 次  未找到指定简历（关键字对不上）← 今天 11:14 / 14:32 / 14:38 / 14:42
```

用户以为“成功过一次”，其实那是**手动菜单①的试运行**（只检查不发送），不会写 `resume_sent`。
所以自动发简历**一次都没真正成功过**。

### 4 次失败说明什么

reason 是「未找到指定简历」而不是「未找到发送简历按钮」或「未找到确认按钮」，说明：
- 「发简历」按钮找到了 ✅
- 弹窗也打开了（否则会是 no_button）
- 但弹窗里没收集到任何简历项 ❌

而手动试运行在同一天早些时候是能收集到 3 个附件的，所以**不是选择器全错，而是时序/结构在自动流程里不同**：
自动流程是页面刚加载、还在扫联系人时就点了发简历，弹窗渲染更慢。

### 修改

1. `waitResumePanel` 8s → **12s**；列表收集重试 8×400ms → **12×500ms**
2. 失败时把现场写进 `job_actions.jsonl`（以前只打在面板上，我这边看不到，无法判断）：
   - `resume_skip_detail`：reason / resumeItems / panelText / panelStructure
   - `resume_dryrun`：手动试运行也落日志，包含条目文本和 DOM 快照
3. 聊天页 `resume_sent/resume_skip` 动作补 `resumeItems` 与 `panelSnapshot` 字段

### 下一步

点一次油猴菜单「① 检查简历弹窗（不发）」，日志里会留下 `resume_dryrun`，
据此就能区分是「条目没渲染出来」还是「渲染出来了但名字匹配不上」。

## 2026-10-27（七）自动发简历读不到条目：后台标签 + 可见性过滤

### 排除掉的可能

用户重新上传简历后失败，一度怀疑文件名变了。截图确认文件名仍是原来的 `简历A.pdf`，
与 `resume.match` 完全对得上 → **不是名字问题**。

### 最可能的真因

- **手动**跑菜单①：聊天页在前台，弹窗正常渲染 → 读到 3 个附件 ✅
- **自动**流程：脚本先 `chatInfo.jobEl.click()` 打开岗位详情，**详情页抢走焦点**，
  聊天页变成后台标签；随后在后台标签里点「发简历」，弹窗元素 `getBoundingClientRect()`
  量出 0 尺寸 → `isVisible()` 全判 false → 收集到 0 项 → 严格模式放弃

同一套选择器，前台能读到、后台读不到，说明问题在**可见性过滤**而不是选择器。

### 修改

1. `collectResumeItems(requireVisible)`：可见项为 0 时，退回**不做可见性过滤**的 `allPanels()` 再收一次
2. `waitResumePanel` 也能用“全量面板文本含简历”判断弹窗已出现，后台标签不会再白等 12 秒
3. `switchToAttachmentTab`、`findConfirmBtn` 同样加“可见为空则用全量”兜底
4. `sendResume` 开头 `window.focus()`（尽力把聊天页拉回前台），详情页关闭后补 600ms 等焦点回归
5. 诊断快照加 `hasFocus / hidden / 面板数`，下次日志能直接看出是不是后台标签

## 2026-10-27（五）招呼语改开身份写法

用户要求：不强调“2029 届”，改成“211 本科在读”。

```
您好！我是 211 本科在读，主攻 Python + Agent。用 LangGraph 独立做过「Agent + RAG」调研系统：
四角色编排、MCP 工具按需装载、检索侧混合召回 + 重排，引用能核到页码，
自建评测集单题成本 ¥0.26，Java 后端也能写。找 AI 应用 / Agent 开发实习，方便发您简历吗？
```

162 → 161 字。动机：写“2029 届”容易被 HR 直接判定“还要读四年、不能长期到岗”，
写“211 本科在读”先过学历筛，届别等对方问了再说。

## 2026-10-27（四）Java 后端放行 + 关键词收敛到 4 个

### 需求

用户：能接受 Java 后端 + AI；纯 Java 岗位搜到也可以投，但不要把 Java 当成搜索关键词。

### 实现

1. **捞回闸门加 Java 例外**（`llm_judge.apply_verdict`）：
   `language in {java, both}` 且 `role_type in {agent_dev, ai_dev}` 时，即使标题没有 AI 方向词也允许捞回。
   这里**刻意不卡模型自评分**——非 AI 岗的模型自评分本来就低（70 左右），
   卡 85 会让“java实习生”这种岗永远进不来。
2. **提示词与画像**：明确“Java 技术栈的后端/全栈开发岗可以投（role_type=ai_dev, language=java）”，
   非 Java 后端（C++/Go/Node/PHP）、纯前端仍填 other 且不投。
3. 新增开关 `llm.allow_java_backend`（默认 true），关掉就回到“只有 AI 方向词才捞回”。

### 关键词收敛

用户决定：只留前 4 个。

```
AI Agent / 智能体开发 / AI应用开发 / 大模型应用开发
```

单轮深度保持：`preloadMaxJobs=200`、`preloadMaxRounds=120`、`preloadStableRoundsLimit=8`。

### 回归

| 岗位 | 结果 |
| --- | --- |
| java实习生（纯 CRUD） | 95 投 |
| 【日常实习】后端开发-SZ（Java 微服务） | 95 投 |
| Python（纯 CRUD） | 48 不投 |
| 软件开发实习生（未说技术栈） | 66 不投 |
| 前端开发实习生 | 36 不投 |
| C++开发工程师（AI Agent 平台） | 0 不投 |
| AI Agent 开发实习生 | 100 投 |

区分依据是 `language`：只放行 Java 技术栈的泛化开发岗，Python/未说明的仍然挡。

## 2026-10-27（三）关键词收敛为 5 个，单关键词挖深

用户决定：只保留前 5 个关键词，每个词搜得更透。

```
AI Agent / 智能体开发 / AI应用开发 / 大模型应用开发 / RAG
```

配套调整（单关键词深度）：

| 字段 | 原 | 现 |
| --- | --- | --- |
| `preloadMaxJobs` | 120 | 200 |
| `preloadMaxRounds` | 80 | 120 |
| `preloadStableRoundsLimit` | 5 | 8 |

说明：轮次结束时会自动切到下一个关键词（`pickNextKeyword` 取模循环），
5 个词一圈后回到第一个，所以“多搜”靠的是单轮加载更多卡片 + 连续 8 轮无增长才判定到底。

## 2026-10-27（二）某个关键词搜不到结果会卡很久

### 现象

用户反馈：跑到 `AI Engineer` 这个 tag 就卡很久。

### 根因（不是 tag 本身的问题）

该关键词搜不到结果时，Boss 页面根本不渲染 `.rec-job-list`，于是：

1. `preloadJobs()` 里 `endlessFind` 失败 → `catch(() => null)` → 岗位数恒为 0，
   但循环照跑，最多 `preloadMaxRounds=80` 轮 × 900ms ≈ **72 秒空滑**
2. `getJobHrefs()` 直接 `throw` → `nextPage()` 抛错 → `loop()` 的 catch 又调 `loop()`
   → 再次 `endlessFind` 等 6~10 秒 → **无限重试**，这就是“卡很久”的主因

所以任何“零结果”的关键词都会卡，不止 `AI Engineer`。

### 修复

1. `getJobHrefs()` 内部重试 2 次（间隔 1.5s），仍拿不到就返回空列表并提示
   “该关键词可能无结果”，不再抛错
2. `nextPage()` 增加空列表防御：`els.length === 0` 直接返回 false，避免 `els[-1]` 下标异常
3. `preloadJobs()` 连续 3 轮没有列表就提前结束，不再空滑 80 轮
4. `loop()` 连续 3 次异常 → `handleRoundExhausted()` 切轮次，不再原地死循环

### 顺带

按用户要求移除 tag `AI Engineer`（搜索词 16 → 15）。

## 2026-10-27（一）投递质量：捞回闸门太松

### 今日数据

```
09:23–10:05 运行
判岗 332 个 → 打招呼 29 个（8.7%）
greet_sent 29 / verified=True 29 / confirmed=cleared 29 / 失败 0
```

发送链路已经稳定：29 次全部有回执、全部确认送达。

### 但 29 个里有 9 个不该投

```
95 规则80 | Python
95 规则80 | java实习生
95 规则56 | 【日常实习】后端开发-SZ
95 规则80 | 全栈开发工程师（实习）
95 规则75 | 软件开发实习生
95 规则75 | 校招·2027届AI方向
95 规则80 | 大模型推理实习生
95 规则80 | DB业务-软件开发实习生（人工智能方向）
95 规则80 | Java后端研发工程师-广州-27校招
```

共同点：**规则分只有 56~80，是模型“捞回”到 95 的**。闸门太松——模型只要说 apply 就抬分。

### 三处收紧

1. **规则层补拦截**：`推理`（推理优化/推理引擎属于算法方向）

   > 届别这条一开始写成了硬拦 `27届 / 2027届 / 校招`，用户指出“有的是 27 届优先，不是只要 27 届”，
   > 属于过度拦截。已改成两级：
   > - **硬拦**只保留明确排除的写法：`仅限27届 / 仅限2027届 / 仅限26届 / 仅限2026届 / 27届毕业生 / 2027届毕业生`
   > - **扣分**：`27届 20 / 2027届 20 / 26届 25 / 2026届 25 / 校招 15`
   >
   > 这样“AI Agent开发实习生（27届优先）”仍然 100 分投出去，“仅限27届”才拦。
2. **捞回闸门**（`apply_verdict`）：规则分 < `min_title_score` 时，模型必须**同时**满足
   - 标题含 AI/大模型/LLM/Agent/智能体/RAG/MCP/Prompt 等方向词
   - `role_type == agent_dev`
   - 模型自评分 ≥ 85

   任一条不满足 → 不捞回（分数压回阈值以下）
3. **提示词**：明确 `ai_dev` 与 `other` 的边界——普通后端/全栈/业务系统开发，
   即使 JD 提到“接入大模型 API”，`role_type` 也只能填 `other`

### 回归

| 岗位 | 结果 |
| --- | --- |
| Python | 48 不投 |
| java实习生 | 40 不投 |
| 【日常实习】后端开发-SZ | 34 不投 |
| 全栈开发工程师（实习） | 39 不投 |
| 软件开发实习生 | 66 不投 |
| DB业务-软件开发实习生（人工智能方向） | 66 不投 |
| 校招·2027届AI方向 | 0 不投（规则拦截） |
| 大模型推理实习生 | 0 不投（规则拦截） |
| Java后端研发工程师-广州-27校招 | 0 不投（规则拦截） |
| AI全栈应用开发实习生（LangGraph+RAG） | 95 投 |

9 个误投全部拦下，真正的 AI 应用开发仍然能捞回。

## 2026-10-26（六）支持英文岗位 / 跨国企业，并扩大候选池

### 背景

用户英语不错，接受跨国企业；同时反馈“符合的岗位太少”（15:00 后 279 个岗位只有 22 个投出去，8%）。

### 问题

1. 词表几乎全是中文，`AI Engineer` / `GenAI Engineer` / `Forward Deployed Engineer` 这类英文标题只命中 `ai`（40 分），
   被 `min_title_score` 封顶 80，全靠模型捞回，漏得很多。
2. 搜索关键词只有 6 个（AI Agent / 智能体开发 / AI应用开发 / 大模型应用开发 / RAG / 工作流工程师），
   候选池本身就窄。

### 修改

- **标题强正向**新增英文写法：`ai agent engineer(97)` / `genai engineer(96)` / `agent engineer(95)` /
  `ai application engineer(95)` / `agentic(94)` / `llm engineer(94)` / `applied ai(94)` / `ai engineer(92)` /
  `ai developer(92)` / `forward deployed(92)` / `ai platform engineer(91)` / `fde(88)`
- **标题阻断**新增：`machine learning` / `deep learning` / `data scientist` / `solutions engineer` / `sales engineer`
- **JD 正文**新增英文技术词：`llm` / `genai` / `agentic` / `multi-agent` / `orchestration` /
  `prompt engineering` / `tool calling` / `vector database` / `crewai` / `autogen` / `langsmith` / `openai` / `anthropic`；
  工程侧 `fastapi` / `rest api` / `postgres` / `redis` / `kubernetes` / `aws` / `gcp` / `azure` / `ci/cd` / `microservices`
- **JD 负向**补英文算法词：`fine-tuning` / `pretraining` / `reinforcement learning` / `computer vision` / `recommendation system`
- **搜索关键词** 6 → 12：增加 `AI Engineer` / `GenAI` / `LLM` / `Agent` / `大模型` / `FDE`

### 实测

| 岗位 | 结果 |
| --- | --- |
| AI Agent Engineer (GenAI) | 100 投 |
| Forward Deployed Engineer, AI | 100 投 |
| AI Engineer | 100 投 |
| Applied AI Engineer | 100 投 |
| GenAI Engineer | 100 投 |
| Machine Learning Engineer | 0 不投（machine learning） |
| AI Product Manager | 0 不投（product manager） |
| Solutions Engineer (AI) | 0 不投（solutions engineer） |

### 说明

英文标题不再依赖模型捞回，规则层直接给到 90 以上，同时算法/产品/售前类仍然被挡住。
候选池扩大后，通过数会随搜索覆盖变多，但通过率（约 8%）不会明显变化——因为瓶颈是“真 Agent 岗位本来就不多”。

## 2026-10-26（四）打招呼超时：一个 ReferenceError 导致的必然超时

### 现象

用户问“为啥会打招呼超时”。翻 `job_actions.jsonl` 统计：

```
greet_queued: 49
chat_open_requested: 49
greet_sent: 0
greet_failed: 0
```

49 次打招呼，**一次回执都没有**。不是偶发超时，是每次都超时。

### 根因

`__chat()` 里的 `sayHi()` 引用了 `logAction`，但 `logAction` 只在两个地方定义：
`__search` 作用域（投放页）和 `chat()` 内部。`sayHi()` 处于 `__chat` 作用域，**拿不到这个名字**。

于是每次打招呼走的是：

1. 握手拿到 `introduce` ✅
2. `sendMsg(introduce)` → 招呼**真的发出去了** ✅
3. `await logAction(...)` → `ReferenceError: logAction is not defined` ❌
4. `catch` 里又 `await logAction(...)` → **再抛一次** ❌
5. 回执 `SAY_HI {success}` 永远发不出去
6. 搜索页只能等满 `greetTimeout`，日志打“打招呼超时，已跳过”，然后 `loop()` 投下一个
7. 下一个岗位用**同一个窗口名**打开聊天页 → 把还在 await 的旧页面直接跳走，连 catch 都没机会跑

所以 `job_actions.jsonl` 里一条 `greet_message_sent` / `greet_message_failed` 都没有——页面在写日志之前就被跳走了。

**实际影响**：招呼发出去了，但脚本以为失败，且完全没有记录。

### 修复

- `logAction` 提升到 `__chat` 作用域（`actionApi + logAction`），删掉 `chat()` 里的重复定义，两条链路共用
- `sayHi()` 改用 `try/catch/finally`：**无论发送、日志是否报错，`finally` 都必定回执**，搜索页不会再干等
- 心跳 `loop()` 补 `.catch()`：搜索页关掉后不再产生未捕获的 Promise 拒绝
- `tools.endlessFind(selector, timeout)` 支持自定义超时；`sendMsg` 改成 8s 找输入框 + 5s 找发送按钮，
  最坏 ~14s，留出余量给 `greetTimeout`
- `greetTimeout` 默认 12s → **25s**（必须大于“页面加载 + 找输入框 + 发送”的最坏耗时）
- 搜索页超时也写日志：新增动作 `greet_timeout`（带 `timeoutMs`），以后能直接在 `job_actions.jsonl` 里查
- 新增非致命校验 `verifyMsgSent()`：发完看聊天记录里有没有这条消息，
  结果写进 `greet_sent.verified`；为 false 时日志提示“请人工看一眼”，但不改变回执结果（避免误判成失败）

### 验证

- `node --check web_script.js` 通过
- 后端单测 3/3 通过
- 下次真实运行应能看到 `greet_sent`（或 `greet_failed`）动作，而不是只剩 `greet_timeout`

### 遗留提醒

当前 `introduce` 有 233 字，Boss 的招呼内容有长度限制，过长可能被截断或发送失败。
建议压到 150 字以内；发送后看 `greet_sent.verified` 是否为 true 即可判断。

## 2026-10-26（三）回复后自动发简历：从“死代码”修成可用

### 背景

用户问“Boss 回复后自动发简历能实现吗，看着有但残缺”。代码确实在，但跑不起来。

### 根因（三处）

1. **被 `onlyGreet` 短路**：`loop()` 里 `jobHrefs` 为空时先判 `if (OPTIONS.onlyGreet) return loop()`，
   于是永远走不到“打开聊天页”那一行。用户配置正好是 `onlyGreet: true`，整块聊天/发简历逻辑等于死代码。
2. **只在轮次结束才检查**：即使 `onlyGreet: false`，也只有“本轮岗位全投完”才打开聊天页。
   一轮几十个岗位要跑十几分钟，Boss 的回复要等到下一轮才被看到。
3. **发了不校验、失败会重复**：`sendResume` 点完确认就直接当成功；聊天页每次都是全新加载，
   没有跨页面的“已发送”记录，一旦 DOM 文案变动就会重复发。

### 修改

- 新增 `autoSendResumeOnReply`（默认 true），与 `onlyGreet` 彻底解耦。
- 搜索页新增 `openChatPoll()`：处理岗位期间按 `chatPollIntervalMs`（默认 3 分钟）打开聊天页检查回复，
  拿到聊天页的完成信号后继续投岗位；`chatPollTimeout`（默认 60 秒）兜底，超时也不卡死。
- 用 localStorage 标记本次打开聊天页是“中途轮询”还是“轮次结束”：
  - 轮询 → 聊天页回 `{poll: true}`，搜索页不推进轮次（否则会重入 `loop()` 造成重复消费 href）
  - 轮次结束 → 仍回 `true`，保持原来的 `nextPage()` 行为
- `WebBroadcast` 增加 `clearInbox(from, type)`：轮询前清掉上一次残留的完成信号，
  否则第二次轮询会读到旧消息，立刻“假完成”。
- `sendResume` 增加回执校验 `verifyResumeSent()`：等待聊天记录出现“点击预览附件简历”，
  4 秒内没出现就提示“已发送但未检测到回执，请人工确认”，而不是假装成功。
- 新增跨页面发送记录 `__zhipin_resume_sent`（localStorage，30 天）：
  轮询会反复重载聊天页，靠它保证同一个人不会重复收到简历。
- 发送失败的联系人记入本次运行的 `failedResumeContacts`，不再反复重试弹窗；重启脚本可重试。
- `job_actions.jsonl` 的 `resume_sent` 记录新增 `verified` 字段。

### 现在的链路

```
投岗位 → 每 3 分钟 → 打开聊天页 → 只处理未读红点 → 没发过简历？
        → 取岗位详情 → resume.match 选简历 → 发送 → 校验回执 → 记 localStorage
```

### 验证

- `node --check web_script.js` 通过
- 后端单测 3/3 通过
- 浏览器侧无法自动化验证，需要真实跑一轮：日志里应依次看到
  `检查 Boss 新回复…` → `简历列表: ...` → `简历已发送` / `简历未发送：原因`

## 2026-10-26（二）职能门控 + 大模型复核

### 背景

上一轮把词表换成 Agent 主线后，真实跑仍然投了：

```
100  GTM实习生（海外市场 · AI Agent 方向）
100  AI Agent 应用实习生（品牌营销方向）
100  售前实习生（偏 AI Agent 方向）
```

### 根因

评分模型只判断“技术方向”，不判断“岗位职能”：

- 标题命中 `ai agent` 直接 96 分，加上 JD 分就顶到 100；
- 阻断词是枚举式的，`市场/GTM/售前/品牌` 没枚举到就漏；
- `product manager`、`AI Product Manager`、`产品负责人` 这类变体也枚举不完。

也就是说：**方向对 ≠ 职能对**。靠加词永远补不完。

### 规则层改动

- 新增 `title_nondev_keywords`（职能门控）：命中即 0 分，与方向无关。
  覆盖产品/市场/营销/品牌/GTM/商务/销售/运营/售前/解决方案/实施/交付/技术支持/顾问/客户/HR/财务/法务/
  设计/编辑/文案/直播/客服/教研/讲师/翻译/文员/经纪/中介…以及 `product manager` 等英文写法。
- 新增 `title_nondev_exceptions`：先剔除“一级市场/二级市场/资本市场/市场驱动”再匹配，
  避免 `AI Agent开发实习生（一级市场分析系统）` 这种金融 IT 开发岗被误杀。
- 新增 `min_title_score`（默认 86）：标题分不够的一律压到阈值以下。
  `web开发实习生`（开发实习 66）即使 JD 写了 Agent 也不投。
- 标题命中但 JD 毫无技术要求 → 封顶 80（打标题党）。
- 匹配器加 `__compact_text`：去掉空白、括号、横线等结构分隔符再比一次，
  `AI Agent 开发` / `AI-Agent开发` / `AI Agent（开发）` 都能命中（保留 `+ / #` 等语义字符，`c++`、`c#` 不受影响）。
- 语言门控：标题拦截 `c++ / c语言 / c# / rust / golang / go语言 / php`；
  去掉原来的 `java: 24` 扣分——本人 Java 后端能写，`AI Agent 开发（Java）` 不该被扣。
- 补平台类正向词 `ai平台(90) / ai中台(88) / 大模型平台(92)`：
  确认 Java 后端 + Agent/大模型平台这条线要投，补上后不依赖模型也能稳定放行；
  同时验证 `训练平台`（被 `训练` 拦）、`平台运营`、`平台售前` 仍被挡。

### 模型层改动（新增 `llm_judge.py`）

规则只能穷举，模型能读 JD 判断“这岗位到底干什么”。所以做成分层：**规则先筛，模型复核**。

- 只对规则没拦死的岗位调用（`mode: hybrid`），规则 0 分的不花 token；
- `mode` 支持 `off / veto / hybrid / always`；
- 强制关闭思考模式：请求体 `{"thinking": {"type": "disabled"}}`
  （DeepSeek V4 默认开思考，开了输出 token 会涨几倍）；
- `response_format: json_object` + `temperature: 0`，只要 5 个字段：
  `apply / score / role_type / language / reason`；
- 双重保险：模型说 apply，但 `role_type` 不是 `agent_dev`/`ai_dev`，或 `language=other` → 强制否决；
- 结果按 `sha1(标题 + JD 前 600 字)` 缓存，`max_calls_per_run` 防跑飞；
- 任何网络/解析异常 → 回落规则分，不阻塞投递；
- `target_profile` / `exclude_rules` 直接写简历要点（Python 为主 + Java 后端 + Agent/RAG 项目经历），
  比堆关键词有效得多。

### 实测（真实调用 DeepSeek `deepseek-flash`）

| 岗位 | 规则 | 模型 | 最终 |
| --- | --- | --- | --- |
| AI Agent 产品经理 | 0（产品经理） | 未调用 | 0 不投 |
| 大模型算法工程师（LLM 训练） | 0（算法/训练） | 未调用 | 0 不投 |
| C++ 开发工程师（AI 推理引擎） | 0（c++） | 未调用 | 0 不投 |
| AI Agent 开发实习生（Python） | 100 | apply / agent_dev / python | 100 投 |
| AI Agent 开发实习生（Java） | 100 | apply / agent_dev / java | 100 投 |
| GTM 实习生（海外市场·AI Agent） | 0（职能门控） | 未调用 | 0 不投 |
| AI Agent 应用实习生（JD 实为售前写标书） | 80 | **skip / marketing** | 80 不投 |
| 大模型工程师（JD 是 Agent/RAG/Python） | 80（标题分不足被封顶） | **apply / agent_dev** | 95 投 |

最后两条是关键：规则拿不准的两个方向，模型都判对了——一个否决掉“假 AI 岗”，一个捞回“标题没写 Agent 但活是 Agent”的岗。

### 成本

单次判岗约 780 输入 + 50 输出 token；按 DeepSeek Flash 2026-10 价（空闲 1 元 / 高峰 2 元每百万输入，输出 4/8 元），
1000 个岗位约 ¥1（空闲）~¥2（高峰）。规则拦掉的岗位不产生调用。

### 验证

- `python -m unittest test_single_route_backend` 3/3 通过
- `node --check web_script.js` 通过
- 真实接口：`/get-job-score` 返回体结构未变，`job_decisions.jsonl` 新增 `ruleScore / llmApply / llmRole / llmLanguage / llmReason / llmLatencyMs` 字段
- 新增 `GET /llm-status` 与 `python llm_judge.py "岗位名" "JD"` 两个自检入口

## 2026-10-26 详情超时、投递方向、指定简历

### 背景

用户跑真实投递时暴露三个问题：

1. 预加载 300 个岗位后，几乎每个岗位都 `获取职位详情超时（>35s）`，一轮全在干等。
2. 想投 Agent 应用开发，但配置里还留着算法 / AI 产品经理的入口。
3. 不知道自动发送简历时到底发的是哪一份，实际发的是平台模板，不是自己指定的附件简历。

### 问题 1：详情页 35s 超时

看 `job_actions.jsonl` 可以确认不是偶发：连续多条全是 `job_skip / 获取职位详情超时`，说明详情页**从来没有回传过**，不是慢，是收不到。根因有四个，叠在一起：

1. **详情页脚本一上来就直接读 DOM**：`__detail()` 里 `nameBox.querySelector(...)` 没做判空。页面还没渲染完（岗位多、标签页被节流时很常见）就抛 `TypeError`，异常没人接，于是永远不会 `broadcast.send`。
2. **时间窗比等待时间短**：`timestampTimeout` 25000 < `detailTimeout` 35000。详情页只有在时间窗内才回传，即使 26s 后才渲染好，也会判定过期直接不回，搜索页只能等满 35s。
3. **没有快速失败**：详情页是风控页 / 结构异常时同样静默，搜索页没有任何信号，只能按最坏情况等满。
4. **回传没有请求关联**：`receive(from, type)` 只按 from/to 匹配。上一份岗位迟到的回传会被下一份岗位当成自己的详情，可能拿着 A 的 JD 给 B 打分。

### 本次修改（`web_script.js`）

- `WebBroadcast` 增加 inbox：没人等待时到达的消息先缓存，`receive` 优先取缓存，消除两次 receive 之间的漏消息窗口。
- 详情页 `__detail()` 改成异步：
  - `waitReady()` 最多等 `detailReadyTimeout`（默认 6s）关键 DOM 就绪；
  - 识别风控页（标题/验证码容器）；
  - `readJobInfo()` 全程 try/catch，**无论成功失败都回传**，失败带上 `error`；
  - 回传带 `href`。
- 搜索页 `getJobInfo()` 拆成 `getJobInfoOnce` + 重试：
  - 按 `job_detail/<id>` 校验回传是不是本轮岗位，不是就丢弃继续等；
  - 详情页报 `error` 时立刻跳过（不等满超时）；
  - 只有“超时”才重试，`detailRetry` 默认 1 次；
  - 弹窗被拦截时直接跳过，不再干等。
- 预加载新增 `preloadMaxJobs` 硬上限并提示：岗位太多会让详情页更慢、更容易被风控。
- 打开详情标签后的固定 1.5s 空等改成 `detailOpenWaitMs`（默认 400ms）。

### 问题 2：投递方向收敛到 Agent 应用开发

- `user_config.json` / `config.py` 的评分词表重做：
  - 标题阻断词新增 `产品经理` / `产品实习` / `产品助理` / `产品策划` / `产品运营` / `ai产品`，以及 `短剧` / `剪辑` / `配音` / `直播` / `电商` / `设计` / `数据标注` 等非研发方向；
  - 标题强正向词改为 Agent 主线：`ai agent` / `agent开发` / `智能体开发` / `ai应用开发` / `大模型应用开发` / `llm应用` / `rag` / `langgraph` / `langchain` / `mcp` / `ai工作流`；
  - 删掉会漏分的噪声词：`实习 82`、`实习生 80`（之前 `AI产品实习生` 就是靠 `实习` 拿到 100 分）；
  - JD 正文侧强化 Agent 技术栈，压低算法训练类。
- 打分验证（同一份 JD 下）：

| 岗位 | 结果 |
| --- | --- |
| AI Agent全栈工程师实习生 | 100 投 |
| 智能体开发工程师 | 100 投 |
| 大模型应用开发工程师 | 100 投 |
| RAG工程师 | 100 投 |
| AI产品实习生 | 0 跳过 |
| AI模型产品经理 | 0 跳过 |
| 算法工程师 | 0 跳过 |
| AI短剧制作实习生 | 0 跳过 |

### 问题 3：指定要发送的简历

原来的 `sendResume()` 有两处会发出“错的简历”：

- 只要出现 `.panel-resume` 小弹窗，就直接点确认——弹窗里默认选中的就是平台在线简历/模板；
- 大弹窗那条路径虽然按 `resumeMatch` 匹配，但匹配不到时**静默按序号兜底**，配置写错了也照发。

现在改成：

- 新增 `frontend.resume` 配置：`name` / `match` / `exclude` / `preferAttachment` / `strict` / `followUpText`；
- 点“发送简历”按钮时优先找工具栏里带“简历”字样的按钮，不再只认一个宽泛选择器；
- 先切“附件简历”页签，再收集面板里所有简历项并打印日志（`简历列表: 0:xxx.pdf | 1:xxx`）；
- 选中顺序：关键字命中（`name` 优先）→ 面板默认已是目标简历 → `strict` 则放弃 → 否则按序号兜底；
- `strict: true` 时匹配不到就**不发**，关掉弹窗并写 `resume_skip` 日志，避免把模板简历发出去；
- 发送结果回传 `sent` / `reason`，聊天页按结果提示“简历已发送”或“简历未发送：原因”。

### 配套改动

- `config.py`：新增 `Config.resume`、`_normalize_resume_config()`（兼容旧 `frontend.resumeMatch`）、`_sanity_check()`（`timestampTimeout <= detailTimeout` 时自动修正）。
- `user_config.example.json`：模板瘦身，不再内置整张 `scoring` 词表（避免旧词残留），只留用户该改的字段，并带上 `resume` 段。
- `readme.md`：补齐 `frontend` 参数、`frontend.resume` 语义、两个超时参数的关系。
- 后端 `job_score_delay_base_ms` 默认值从 2000 降到 500：本地打分接口的人为延迟没有必要那么大。

### 验证

- `node --check web_script.js` 通过。
- `python -m unittest test_single_route_backend` 3/3 通过。
- 用历史岗位标题回放打分，Agent 类通过、算法/产品类拦截，符合预期。

## 2026-04-26 文档收口与长期记忆清理

### 本次目标

- 只整理 Markdown 文档，不改代码。
- 让 `readme.md`、`PROJECT_MEMORY.md`、`DEV_LOG.md` 三份文档对当前主线表述一致。
- 把长期记忆文件里偏阶段性、易过期、过细的描述收掉，保留真正值得跨会话继承的部分。

### 本次处理

- 重写了 `PROJECT_MEMORY.md`，把内容收口为：
  - 项目长期目标
  - 当前主线定位
  - 已确认的长期决策
  - 接手时优先看的关键文件
- 删除或弱化了几类不适合继续放在长期记忆里的内容：
  - 过细的阶段性调参痕迹
  - 某天临时验证过但未必长期稳定的实现细枝末节
  - 容易和开发日志重复的按时间推进描述
- 微调了 `readme.md` 的表述，让它更明确对齐当前公开主线：
  - 单简历
  - 单方向
  - 规则筛选
  - AI 产品工程 / AI 应用落地 / Agent / 工作流方向
  - 普通用户主要只需要改 `introduce`、`tags`、`resumeIndex`、`thread`
- 后续又继续扫了一遍仓库内 Markdown，确认主线文案主要集中在：
  - `readme.md`
  - `PROJECT_MEMORY.md`
  - `DEV_LOG.md`
  - `resume-example.md`
- 其中额外把 `resume-example.md` 也收到了当前默认方向，避免模板还停留在运维 / DevOps / SRE 旧口径。
- 保持代码、配置、脚本逻辑完全不动，只做文档收口。

### 为什么这样做

- `PROJECT_MEMORY.md` 应该更像“长期有效背景与决策”，而不是第二份开发流水账。
- `readme.md` 应优先服务新用户和公开仓库理解，不该混入太多历史包袱。
- `DEV_LOG.md` 则保留“这次具体做了什么”的过程记录，三者分工要清楚。

## 2026-04-23 主线回收为单简历版本

### 背景

- 项目在个人使用阶段曾长出一版“双简历 / 双方向自动路由”方案。
- 这套方案对老板自己某个阶段是有用的，但代码复杂度明显上升，公开展示和新用户上手都变差了。
- 后续老板自己的真实使用需求也已经收敛为：只投单个方向、只发一份简历，不再需要双路由。

### 这次处理思路

- 不重写 Boss 页面自动化底层机制。
- 先把历史双路由版本归档到独立分支。
- 再把主线回收到“单简历、单方向、公开版更易懂”的形态。

### 这次主线回收做了什么

- 后端移除了双路由相关配置与决策逻辑：
  - 删除 `deliveryProfiles`
  - 删除 `routing`
  - 删除 `routeJobProfile()`
  - 删除 `evaluateJobDelivery()`
- 后端新增单路由决策函数：
  - `evaluateSingleRouteDelivery()`
- `/get-job-score` 接口收敛为固定单路由返回：
  - `score`
  - `introduce`
  - `resumeIndex`
- `web_script.js` 去掉了 `profile / routeReason / routeScores` 等双路由语义
- `user_config.example.json` 收回为公开版单简历模板
- `readme.md` 重写为单简历主线说明
- 后续又针对 AI 产品工程师方向继续收紧评分策略：
  - 搜索关键词收敛到 AI 产品工程 / AI 应用 / Agent / 工作流相关岗位
  - 标题词权重下降，不再过度依赖岗位名字字面命中
  - 正文技术要求权重上升，更重视 Claude Code / Cursor / Codex / Agent / Workflow / Prompt / 需求到落地闭环
  - 对传统算法训练岗、C/C++/Go、以及过重的 LangChain / LlamaIndex 套话做了更精细的压制或降权
  - 对“产品助理 / 产品策划 / 实习生”这类泛产品岗位降低标题权重，避免和核心目标岗拉不开差距

### 为什么这样做

- 老板后续不再需要双简历自动切换
- 双路由方案继续放在主线里，只会增加维护和理解负担
- 对这个项目最重要的仍然是 Boss 页面自动化链路稳定，而不是功能看起来更复杂

### 当前主线定位

当前主线明确定位为：
- Boss 直聘单简历自动投递脚本
- 规则筛选岗位
- 固定打招呼
- 收到新消息后直接发送简历
- 默认不继续自动聊天

### 历史归档

双路由历史版本已单独归档到分支：
- `archive/double-routing-chaos`

该分支仅供历史参考，不再作为公开主线推荐入口。

## 2026-03-28

### 本次目标

- 降低 `goodjob` 在批量打招呼时对本地 `Ollama` 的依赖。
- 保持 Boss 侧现有页面元素解析逻辑不变，不新增选择器依赖。
- 保持前端脚本与后端接口兼容，尽量只替换匹配逻辑。

### 现状判断

- 现有脚本会从 Boss 职位详情页获取：
  - 岗位标题
  - 薪资范围
  - 职位描述正文
- 前端会把这些内容拼成一段文本，请求后端 `/get-job-score`。
- 原来的后端 `calcJobScore()` 会调用本地 `Ollama` 计算匹配度，再由前端用阈值判断是否投递。
- 用户当前的真实使用场景主要是“批量打招呼”，不依赖复杂回复能力。

### 本次修改

- 修改了 [core.py](C:/Users/czc/Desktop/czc_code/goodjob/core.py)：
  - 保留 `calcJobScore(job, resume)` 接口不变。
  - 去掉岗位匹配度里的大模型计算逻辑。
  - 新增基于文本分段的字段提取逻辑，从请求文本中取出“岗位标题”和“职位描述”。
  - 新增关键词命中函数。
  - 改为：
    - 岗位标题命中关键词，返回 `100`
    - 职位描述命中关键词，返回 `100`
    - 否则返回 `0`
- 修改了 [config.py](C:/Users/czc/Desktop/czc_code/goodjob/config.py)：
  - 新增 `title_keywords`
  - 新增 `detail_keywords`
  - 后续可以直接在这里维护匹配词库

### 设计取舍

- 没有修改 `web_script.js` 的页面解析逻辑。
- 没有新增 Boss 页面元素依赖。
- 没有改变 `/get-job-score` 的接口路径和返回结构。
- 这样前端原有 `score >= OPTIONS.thread` 的投递判断可以继续工作。
- 当前实现本质上已经不是“打分”，而是“命中即通过”。

### 当前行为

- 只要岗位标题命中配置关键词，就会直接进入投递流程。
- 如果标题没命中，但职位描述正文命中配置关键词，也会进入投递流程。
- 如果标题和正文都没命中，则不会投递。

### 当前已知限制

- `getTags`、`getIntroduce`、`reply`、`isNeedResume`、`isNeedWorks` 这些接口仍然保留了大模型依赖。
- 如果后续只保留“批量打招呼”用途，可以继续去掉这些接口对应的模型调用。
- 终端里查看部分中文文件会出现乱码，这是编码显示问题，不等于源码本身损坏。

### 后续建议

- 如果目标只是批量打招呼，可以继续做第二轮精简：
  - 固定搜索关键词，不再依赖 `/tags`
  - 固定打招呼文案，不再依赖 `/get-introduce`
  - 关闭自动聊天回复逻辑
  - 这样可以把本地大模型依赖进一步压缩到接近零
- 需要调整匹配范围时，优先改 [config.py](C:/Users/czc/Desktop/czc_code/goodjob/config.py) 中的关键词列表。

### 本次验证

- 已执行 `py_compile`，`core.py` 与 `config.py` 语法通过。
- 已用英文关键词样例验证：
  - 命中标题关键词时返回 `100`
  - 未命中时返回 `0`

## 2026-03-28 网申跳过修复

### 问题

- Boss 职位列表里混入了国企/校招网申岗位。
- 这类岗位的主按钮不是“立即沟通”，而是“立即网申”之类的入口。
- 原脚本默认所有可投岗位都能进入聊天页，因此遇到网申岗位时会卡在投递链路中，导致整个批量流程停住。

### 修改策略

- 只改 [web_script.js](C:/Users/czc/Desktop/czc_code/goodjob/web_script.js)。
- 不新增 Boss 页面元素依赖，只复用现有的 `STARTCHAT` 按钮元素。
- 采用两层保护：
  - 主动识别：详情页读取按钮文案，不是“立即沟通”就直接标记跳过
  - 超时兜底：详情回传超时或打招呼回执超时，也直接跳过

### 本次修改

- 在 [web_script.js](C:/Users/czc/Desktop/czc_code/goodjob/web_script.js) 的 `OPTIONS` 中新增：
  - `detailTimeout`
  - `greetTimeout`
- 在详情页 `getJobInfo()` 中新增：
  - `actionText`
  - `skip`
  - `skipReason`
- 跳过条件：
  - 找不到开始沟通按钮
  - 按钮文案不是“立即沟通”
  - 缺少聊天链接或加聊天列表链接
- 在搜索页 `getJobInfo()` 中新增详情获取超时处理：
  - 超时后返回 `skip: true`
- 在搜索页主循环中新增：
  - 如果岗位被标记为 `skip`，记录原因并直接进入下一个岗位
- 在搜索页打招呼流程中新增：
  - `pendingGreetTimer`
  - 如果打开聊天页后超过 `greetTimeout` 仍未收到回执，则记录超时并跳过
  - 正常收到打招呼成功/失败回执时清理超时定时器

### 预期效果

- 普通可聊天岗位继续按原流程执行。
- “立即网申”岗位会被直接跳过，不再把脚本卡死。
- 即使 Boss 页面结构或跳转链路偶发异常，也会因超时机制自动恢复到下一个岗位。

### 本次验证

- 已执行 `node --check web_script.js`，语法通过。

## 2026-03-29 后端匹配日志增强

### 问题

- 测试筛选逻辑时，后端终端里只能看到接口被调用，缺少可读的匹配结果日志。
- 用户无法直接判断某个岗位是“命中过滤词后通过”，还是“未命中后跳过”。

### 本次修改

- 修改了 [core.py](C:/Users/czc/Desktop/czc_code/goodjob/core.py)：
  - 新增 `evaluateJobMatch(job)`，返回匹配明细
  - 明细包括：
    - `title`
    - `matched_field`
    - `keyword`
    - `score`
- `calcJobScore()` 改为复用 `evaluateJobMatch()` 的结果，保持原有返回分数逻辑不变
- 修改了 [main.py](C:/Users/czc/Desktop/czc_code/goodjob/main.py)：
  - `/get-job-score` 在返回前会打印结构化终端日志
  - 日志内容包括：
    - 时间
    - 岗位标题
    - 命中位置（岗位名称 / 职位描述 / 未命中）
    - 命中关键词
    - 最终分数

### 终端日志示例

- `[2026-03-29 09:57:21] /get-job-score | title=Java开发 | matched=未命中 | keyword=无 | score=0`
- `[2026-03-29 09:57:30] /get-job-score | title=运维开发 | matched=岗位名称 | keyword=运维 | score=100`

### 本次验证

- 已执行 `py_compile`，`main.py` 与 `core.py` 语法通过。
- 已本地调用 `get_job_score()`，确认终端会打印匹配日志，接口返回结构仍为 `{'score': ...}`。

## 2026-03-29 关键词加权算法替代大模型打分

### 目标

- 不再使用“大模型判断岗位匹配度”。
- 用纯规则算法替代，保留现有 `/get-job-score` 接口和前端阈值判断。
- 让岗位标题成为主判断信号，职位描述只做辅助。
- 尽量贴近 `运维 / 运维开发 / DevOps / SRE / 平台工程` 岗位。

### 新算法

- 第一步：标题负向拦截
  - 标题命中这些词直接 `score = 0`
  - 例如：`java`、`前端`、`后端`、`管培生`、`项目经理`、`数据开发`、`销售`
- 第二步：标题高权重打分
  - `title_strong_keywords`
  - `title_medium_keywords`
  - 只取最高一档，不叠加
- 第三步：职位描述辅助加分
  - `detail_infra_keywords`
  - `detail_support_keywords`
  - 并分别设置封顶，避免正文泛词抬分过高
- 第四步：职位描述负向扣分
  - 例如：`spring boot`、`react`、`vue`、`客户`、`销售`、`光伏`
- 第五步：组合加分
  - 标题命中强关键词且正文命中多个基础设施词，再加分
  - `DevOps/SRE` 与 `k8s/docker/prometheus` 同时出现时，再加分
- 第六步：标题缺失时强制封顶
  - 如果标题没有命中正向关键词，则最终分数最多 `55`
  - 这样正文里的 `python/shell/监控/部署` 不会单独把岗位抬过投递阈值

### 代码变更

- 修改了 [config.py](C:/Users/czc/Desktop/czc_code/goodjob/config.py)
  - 删除原来的简单 `title_keywords` / `detail_keywords`
  - 新增：
    - `title_negative_keywords`
    - `title_strong_keywords`
    - `title_medium_keywords`
    - `detail_infra_keywords`
    - `detail_support_keywords`
    - `detail_negative_keywords`
- 修改了 [core.py](C:/Users/czc/Desktop/czc_code/goodjob/core.py)
  - `evaluateJobMatch()` 现在返回完整打分明细
  - `calcJobScore()` 改为返回这套规则算法的最终分数
- 修改了 [main.py](C:/Users/czc/Desktop/czc_code/goodjob/main.py)
  - 终端日志新增：
    - `title_score`
    - `detail_score`
    - `combo_score`
    - `penalty_score`
    - `reason`

### 预期效果

- `DevOps / SRE / 运维工程师 / 运维开发 / 平台工程` 更容易过线
- `Java开发 / 前端开发 / 管培生 / 项目经理 / 数据开发` 更容易被拦掉
- 正文里偶然出现 `python/shell/监控` 的非目标岗位，不会再轻易被误投

### 本次验证

- 已执行 `py_compile`，`config.py`、`core.py`、`main.py` 语法通过。
- 已本地样例验证：
  - `DevOps / SRE` 返回高分

## 2026-04-14 同账号双方向路由、挂机稳定性与 Chrome 副本排障

### 这次处理的主线

这次围绕 `goodjob` 主要做了三类事情：

1. **把同一个 Boss 账号下的 AI / 运维双方向投递路由真正接起来**
2. **修复挂机时容易中断的几个现实问题**（Boss 当日打招呼上限、Edge 标签页休眠、空轮自动停机）
3. **尝试做 Chrome 独立副本**，用于双浏览器双账号并行；目前该副本仍未稳定，不作为正式主线方案

---

### 一、这次确认下来的稳定主线

当前老板可稳定使用的主线仍然是：

- **Edge 单浏览器**
- **同一个 Boss 账号**
- 同一个后端
- 根据岗位自动路由：
  - `AI` 岗位 → AI 招呼语 + AI 简历索引
  - `运维` 岗位 → 运维招呼语 + 运维简历索引
- 老板若要兼顾第二个账号，当前更稳的方式是：
  - **继续在 Edge 里手动切账号**
  - 例如半天跑大号、半天跑小号

也就是说，当前正式推荐方案不是 Chrome 副本，而是：

**先把 Edge 主线当作生产可用版本，Chrome 线视为实验分支。**

---

### 二、这次查明并验证的关键问题

#### 1. 不是程序坏了，而是 Boss 当日打招呼上限拦截了流程

这次一度出现：
- 高分岗位可以 `greet_queued`
- 但全部立刻 `greet_queue_failed`

后续通过增强动作日志，明确记录到了：
- `addUrl`
- `chatUrl`
- `reason`

新日志显示失败原因为：
- `Error: biz_fail:温馨提示`

老板后续手动确认后发现，Boss 页面实际弹窗提示是：
- 当天已投递/打招呼达到阶段上限
- 需要手动确认一次
- 再点“立即沟通”后，后续打招呼流程又恢复正常

这说明这轮失败不是前端逻辑本身坏掉，而是：

**Boss 页面在达到当日额度后，会在“加入聊天列表 / 发起沟通”之前弹额外确认。**

这类现象后续要优先判断为：
- 页面业务拦截
- 不是代码立刻回归

---

#### 2. Edge 后台挂机时，标签页休眠会影响持续运行

老板在实际挂机过程中发现：
- Edge 后台标签页会变灰，进入休眠
- 一旦休眠，页面脚本容易中断或不再持续推进

因此当前稳定做法应补充为：
- 在 Edge 设置中关闭或放宽睡眠标签页
- 至少将 `zhipin.com` 加入“永不休眠”例外名单
- 必要时到 `edge://discards/` 检查对应标签页是否被自动 discard

这属于挂机场景的**环境配置要求**，不是评分逻辑问题。

---

#### 3. 连续空轮自动停止不适合挂机，现已改成自动切下一个关键词

原逻辑是：
- 连续 `maxEmptyRounds`（默认 3）轮没有新岗位
- 直接自动停止

这在短时测试时合理，但对“挂机省时间”目标不合理。

因此本次已修改原项目 [web_script.js](C:/Users/czc/Desktop/czc_code/goodjob/web_script.js)：
- 当连续空轮达到阈值时
- **不再停止脚本**
- 而是：
  - 记录日志：`连续 X 轮没有新岗位，自动切换到下一个关键词继续挂机`
  - 重置 `emptyRounds`
  - 直接进入下一轮关键词

这条改动属于当前主线的正式稳定性增强。

---

### 三、这次暴露出的配置链问题与修复

#### 问题：搜索关键词顺序改了但不生效

这次明确定位到一个关键坑：

- 顶层 `tags` 虽然已改成运维优先
- 但运行时默认 `ACTIVE_PROFILE = ai`
- `load_user_config()` 会把 `profiles.ai` 覆盖到顶层配置上
- 因此实际前端拿到的仍然是 `profiles.ai.tags`

这导致：
- 老板以为改了搜索顺序
- 实际运行时仍然先搜 AI 关键词

#### 处理结果

后续已将配置链收口为：
- **搜索关键词只认顶层 `tags`**
- `profile` 覆盖继续保留，但不再覆盖 `tags`

这样同账号双方向场景下，才不会再出现：
- 搜索顺序和岗位路由绑死在一起
- 改顶层配置却不生效

这是这轮中非常重要的一条长期经验：

**搜索层的关键词轮换，不应该再和 profile 的 delivery 配置绑死。**

---

### 四、Chrome 副本方案：已尝试，但暂不作为正式方案

这次为了实现：
- Edge 大号
- Chrome 小号
- 两边共存

曾复制出独立副本目录：
- `C:\Users\czc\Desktop\czc_code\goodjob-chrome`

并做了：
- 后端端口切到 `8001`
- `serverHost` 改到 `127.0.0.1:8001`
- 广播 channel / target 改成 chrome 专用前缀

#### 但当前结论是

Chrome 副本目前仍存在前端多标签页协作不稳定问题，主要表现为：

- 预加载完成后切到“处理聊天消息”阶段时容易卡住
- 暂停/继续后能推进一步，但不能自然稳定循环
- 搜索分支和聊天分支里都出现过：
  - 自己收到自己的广播
  - 多实例冲突
  - 标签页身份漂移

因此现在不应把 `goodjob-chrome` 当成正式推荐方案。

---

### 五、这次在 Chrome 副本上做过的增强（仅作记录）

虽然 Chrome 副本暂不推荐，但这次确实做过几项有价值的诊断和加固：

#### 1. 广播通道隔离

- 对 Chrome 副本加入了独立广播名前缀
- 避免与 Edge 版本抢同一套 channel

#### 2. 目标页心跳 / 回执增强

- 增加了页面实例识别
- 增加了部分回执打印
- 便于判断到底卡在：
  - 搜索页
  - 聊天页
  - 详情页
  - 广播通信层

#### 3. 更多状态日志

- 增强了搜索轮次日志
- 增强了阶段切换日志
- 便于后续若还要继续救 Chrome 副本时快速排查

但这些增强目前仍不足以把它升级为正式稳定方案。

---

### 六、这次与双简历路由有关的实现状态

#### 1. 同账号双简历路由已经真正接通

当前主线（Edge 版）中，这条链路已经是接通的：

- 后端岗位评分：
  - 仍负责“值不值得投”
- 后端新加的 `routing`：
  - 负责“发 AI 简历还是运维简历”
- 后端可返回：
  - `score`
  - `profile`
  - `introduce`
  - `resumeIndex`
- 前端已接入：
  - 打招呼使用 `decision.introduce`
  - 发简历使用 `decision.resumeIndex`

也就是说：

**这套“同一个 Boss 账号，按岗位方向自动切 AI / 运维招呼语与简历索引”的链路已经不是概念，而是正式接通过的能力。**

#### 2. 但这套能力不应再继续往公开用户通用产品方向抽象过度

原因也在这次越来越清楚：

- 它非常贴合老板自己的真实场景
- 但对公开仓库用户来说，理解成本高
- 继续往“多人通用双简历产品”方向抽象，会明显增加维护复杂度

所以后续若继续维护：
- 应优先站在“老板自己长期使用”角度
- 而不是先站在“陌生用户开箱即用”角度

---

### 七、这次额外确认过的工程经验

#### 1. 动作日志非常重要

这次很多判断不是靠猜，而是靠动作日志落地确认的，例如：
- `greet_queued`
- `chat_open_requested`
- `greet_queue_failed`
- `resume_sent`

没有这些日志，很容易把 Boss 侧业务拦截误判成代码故障。

#### 2. 挂机类工具的重点不是“代码逻辑正确”这么简单

实际稳定性还取决于：
- Boss 页面当日限制
- 浏览器是否休眠
- 页面是否被 discard
- 用户是否提前手动选好过滤条件
- 前端广播页是否仍活着

也就是说，后续对这类项目的“稳定”理解应该是：

**代码 + 浏览器环境 + 平台业务限制，三者一起看。**

---

### 八、当前建议

1. **正式使用继续以 Edge 单浏览器主线为准**
2. 老板若想兼顾小号，优先继续手动切账号，而不是依赖 Chrome 副本
3. 若后续还要救 Chrome 线，应明确把它当实验分支，不和主线混在一起
4. 对 Boss 页面异常，要优先先看动作日志，再判断是否真是代码回归
5. 对挂机场景，要把“关闭标签页休眠”当成标准环境要求写进说明
