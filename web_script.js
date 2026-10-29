// ==UserScript==
// @name         goodJobs
// @namespace    http://tampermonkey.net/
// @version      2025-02-15
// @description  goodJobs篡改猴插件
// @match        https://www.zhipin.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=zhipin.com
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function () {
    'use strict';

    // 配置项
    const OPTIONS = {
        resumeIndex: 0, // 兜底用的简历序号，从 0 开始；正常情况下按 resume.match 选简历
        serverHost: 'http://127.0.0.1:8000', // 本地服务的主机地址
        thread: 50, // 分数阈值，低于这个就不发消息了
        // 注意：timestampTimeout 必须大于 detailTimeout。
        // 详情页只有在“时间窗”内才会把岗位信息回传给搜索页，
        // 一旦时间窗比 detailTimeout 短，搜索页就永远等不到回传，只能超时跳过。
        timestampTimeout: 45000, // 跨页时间窗，单位毫秒
        onlyGreet: false, // 是否只打招呼，默认为false，即打招呼和代聊天
        manualFilterWaitMs: 10000, // 每轮搜索后留给用户手动筛选的时间
        roundRestartDelayMs: 2000, // 本轮结束后，启动下一轮前的缓冲时间
        maxEmptyRounds: 3, // 连续多少轮没有拿到新岗位后切换关键词（不是停止）
        // 安全阀：Boss 平台按天限制沟通数（约 150/天），这里留余量。0 表示不限制
        maxGreetsPerDay: 120, // 当天累计最多打招呼多少个（跨重启有效，存 localStorage）
        maxGreetsPerRun: 0, // 本次运行最多打招呼多少个（0=不限，日常靠日限兜底）
        maxRunHours: 6, // 本次运行最多跑多少小时
        maxRounds: 0, // 最多跑多少轮（0=不限）
        detailTimeout: 15000, // 单次获取职位详情的等待上限
        detailRetry: 1, // 详情超时后的重试次数（只对“超时”重试，明确失败不重试）
        detailReadyTimeout: 6000, // 详情页等待关键 DOM 就绪的上限，超时立刻回报错误，不再干等
        detailOpenWaitMs: 400, // 打开详情标签后先等多久再开始收消息
        greetTimeout: 25000, // 打招呼页回执超时：要大于“页面加载 + 找输入框(8s) + 发送(5s)”的最坏耗时
        preloadScrollPixels: 180, // 岗位预加载：每轮下滑像素
        preloadScrollWaitMs: 450, // 岗位预加载：每轮等待毫秒数
        preloadStableRoundsLimit: 24, // 岗位预加载：连续多少轮无增长后结束
        preloadMaxRounds: 300, // 岗位预加载：最多滑动多少轮
        preloadMaxJobs: 0, // 岗位预加载：岗位数上限，0 表示不限；建议 80~120，岗位太多会拖慢详情页
        preloadActivateCardEvery: 0, // 预加载时每隔多少轮尝试轻点一次左侧岗位卡片，0 表示关闭
        preloadActivateCardWaitMs: 250, // 轻点岗位卡片后的额外等待时间
        // Boss 回复后自动发简历：和 onlyGreet 无关，独立开关
        autoSendResumeOnReply: true,
        chatPollIntervalMs: 180000, // 处理岗位期间，每隔多久去聊天页看一次新回复
        chatPollTimeout: 60000, // 单次检查最多等多久，超时就继续投岗位
        // 指定简历：优先按 resume.match 里的关键字匹配，匹配不到就不发（strict）
        resume: {
            name: '', // 想发的那份简历的名字/文件名关键字，排在最前面匹配
            match: [], // 关键字列表，按顺序匹配
            exclude: ['在线简历', '模板简历'], // 明确不发的简历
            preferAttachment: true, // 优先切到“附件简历”页签
            strict: true, // true：匹配不到就放弃发送；false：允许发出默认选中的简历
            followUpText: '已发送，请查收', // 发完简历后补一句话，置空则不补
        },
        resumeMatch: '', // 旧字段，逗号分隔的关键字，仍兼容
    };

    // 元素选择器
    const SELECTORS = {
        ZHIPIN: {
            SEARCH: {
                SEARCHINPUT: 'input', // 搜索框
                SEARCHBTN: '.search-btn', // 搜索按钮
                JOBLISTCTN: '.job-list-container', // 职位列表容器
                JOBLIST: '.rec-job-list', // 职位列表
                JOBCARD: '.job-card-box', // 左侧岗位卡片
                JOBHREFS: '.job-card-box .job-name', // 职位链接
            },
            DETAIL: {
                STARTCHAT: '.btn-startchat', // 开始聊天按钮
                NAMEBOX: '.name', // 职位名称盒子
                JOBNAME: 'h1', // 职位名称
                SALARY: '.salary', // 职位薪资
                DETAIL: '.job-sec-text', // 职位详情
                CHATURL: 'redirect-url', // 聊天链接
            },
            CHAT: {
                // 聊天
                CHATINPUT: '#chat-input', // 聊天输入框
                MSGSEND: '.btn-send', // 消息发送按钮
                // 聊天记录
                HISTORYCTN: '.chat-message', // 聊天记录容器
                USEFULMSG: '.item-friend,.item-myself', // 有效的文字聊天记录项
                MSGCONTENT: '.message-content .text', // 聊天记录内容
                // 职位
                JOBEL: '*[ka=geek_chat_job_detail]', // 职位元素
                JOBCITY: '.city', // 职位城市
                // 简历
                RESUMESEND: '.toolbar-btn.tooltip.tooltip-top', // 简历发送按钮
                RESUMEMODAL: '.panel-resume', // 简历发送弹窗，有的时候简历按钮点击会出来一个小弹窗
                RESUMEMODALCONFIRM: '.btn-sure-v2', // 简历发送弹窗确认按钮
                RESUMELIST: '.resume-list', // 简历列表
                RESUMELISTITEM: 'li', // 简历列表项
                RESUMESENDCONFIRM: '.btn-confirm', // 简历发送确认按钮
                // 联系人
                CONTACTLISTEMPTY: '.no-data', // 联系人列表为空
                CONTACTLIST: '.user-list-content', // 联系人列表
                CONTACTLISTITEM: 'li', // 联系人列表项
                NEWMSGNOTICE: '.notice-badge', // 新消息通知图标
                USERNAME: '.name-text', // 联系人名称
            }
        },
    };

    // 搜索路径
    const SEARCHPATH = {
        zhipin: '/web/geek/job',
    };

    // 白名单
    const WHITELIST = {
        zhipin: {
            deatil: '/job_detail',
            chat: '/web/geek/chat'
        },
    };

    // 标记这次打开聊天页是“途中轮询新回复”还是“轮次结束处理”
    const CHAT_MODE_KEY = '__zhipin_chat_mode';
    const CHAT_MODE_POLL = 'poll';

    // 工具
    const tools = {
        inWhiteList: function (pathObj) {
            return Object.values(pathObj).some((path) => location.pathname.startsWith(path));
        },
        endlessFind: function (selector, timeout = 10000) {
            return new Promise((resolve, reject) => {
                // 初始立即检查元素是否存在
                let element;
                try {
                    element = document.querySelector(selector);
                } catch (e) {
                    reject(e); // 处理无效选择器
                    return;
                }
                if (element) {
                    resolve(element);
                    return;
                }

                // 设置超时
                const timeoutId = setTimeout(() => {
                    observer.disconnect();
                    reject(new Error('未找到目标元素'));
                }, timeout);

                // 定义MutationObserver回调
                const observer = new MutationObserver((_, obs) => {
                    try {
                        const el = document.querySelector(selector);
                        if (el) {
                            obs.disconnect();
                            clearTimeout(timeoutId);
                            resolve(el);
                        }
                    } catch (e) {
                        obs.disconnect();
                        clearTimeout(timeoutId);
                        reject(e);
                    }
                });

                // 开始观察整个文档的DOM变化
                observer.observe(document.documentElement, {
                    childList: true,
                    subtree: true
                });
            });
        },
        inputText: function (el, text) {
            el.value = text;
            el.dispatchEvent(new Event('input', { bubbles: true }));
        },
        asyncSleep(ms) {
            return new Promise((resolve) => {
                // 创建一个 Blob 对象，包含 Web Worker 的代码
                const workerCode = `self.addEventListener('message', function(e) {
                    const delay = e.data;
                    setTimeout(function() {
                        self.postMessage('done');
                    }, delay);
                });`;

                const blob = new Blob([workerCode], { type: 'application/javascript' });
                const workerUrl = URL.createObjectURL(blob);

                const worker = new Worker(workerUrl);
                worker.onmessage = function () {
                    resolve();
                    worker.terminate(); // 使用后终止worker
                    URL.revokeObjectURL(workerUrl); // 释放对象URL
                };
                worker.postMessage(ms);
            });
        },
        getTimestamp(key) {
            return Number(localStorage.getItem(key));
        },
        openTabNSetTimestamp(href, key, self = false) {
            localStorage.setItem(key, new Date().getTime());
            const ref = window.open(href, self ? '_self' : key);
            return ref;
        },
    };

    /**
     * 横幅
     * @param {string} text 显示的文本
     */
    function banner(text) {
        const el = document.createElement('div');
        el.style.cssText = `
                position: fixed;
                top: 60px;
                left: 50%;
                transform: translateX(-50%);
                z-index: 9999;
                background-color: rgba(0,0,0,.5);
                padding: 4px 20px;
                text-align: center;
                border-radius: 8px;
                color: #fff;
        `;
        el.innerText = text;
        document.body.appendChild(el);
        setTimeout(function () {
            el.remove();
        }, 3000);
    }

    /**
     * 转换时间
     * @param {number} seconds 秒数
     * @returns {string} 转换后的时间字符串
     */
    function convertTime(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;

        return `${hours.toString().padStart(2, 0)
            } : ${minutes.toString().padStart(2, 0)
            } : ${secs.toFixed(0).padStart(2, 0)
            }`;
    }


    // 应用后端下发的前端配置（resume 需要二级合并，避免覆盖默认值）
    // 搜索页和聊天页都要用：聊天页也必须知道 resume.match 才能发简历
    function applyFrontendOptions(frontend, log) {
        const say = typeof log === 'function' ? log : function () { };
        if (!frontend || typeof frontend !== 'object') return;
        const nextResume = Object.assign({}, OPTIONS.resume || {});
        for (const key of Object.keys(frontend)) {
            const value = frontend[key];
            if (value === undefined || value === null) continue;
            if (key === 'resume' && typeof value === 'object') {
                Object.assign(nextResume, value);
            } else {
                OPTIONS[key] = value;
            }
        }
        OPTIONS.resume = nextResume;

        // 自检：详情页只在时间窗内回传，时间窗必须比详情等待长
        const detailTimeout = Number(OPTIONS.detailTimeout) || 0;
        const timestampTimeout = Number(OPTIONS.timestampTimeout) || 0;
        if (detailTimeout && timestampTimeout <= detailTimeout) {
            OPTIONS.timestampTimeout = detailTimeout + 15000;
            say(`配置自检：timestampTimeout(${timestampTimeout}) 应大于 detailTimeout(${detailTimeout})，` +
                `本次自动调整为 ${OPTIONS.timestampTimeout}，请同步修改 user_config.json`);
        }
        const resumeKeywords = (OPTIONS.resume.match || []).join(' / ') || (OPTIONS.resume.name || '未配置');
        say(`简历策略：指定关键字 [${resumeKeywords}]，严格模式 ${OPTIONS.resume.strict !== false ? '开' : '关'}`);
    }

    // 风控 / 验证码 / 访问受限页（搜索页与详情页共用，所以放在模块作用域）
    function detectBlockPage() {
        const title = document.title || '';
        if (/安全验证|验证码|访问异常|操作频繁|访问受限|无法访问/.test(title)) return title.trim();
        if (document.querySelector('#captcha, .captcha, .verify-wrap, .boss-verify')) return '验证码页面';
        // Boss 的「访问受限」页标题仍然是「BOSS直聘」，只能看正文；
        // 该页正文极短（就一句“抱歉，您暂时无法访问此页面”），用 textContent 足够且不触发重排
        const raw = (document.body && document.body.textContent) || '';
        const head = raw.replace(/\s+/g, '').slice(0, 200);
        if (/访问受限|暂时无法访问|访问异常|操作过于频繁|请求过于频繁|稍后再访问/.test(head)) return '访问受限页';
        return '';
    }

    class WebBroadcastError extends Error {
        constructor(code, message) {
            super(message);
            this.code = code;
            this.name = 'WebBroadcastError';
        }
    }

    class WebBroadcast {
        static ID_COUNTER = 0; // 自增序列，避免时间戳冲突

        /**
         * @param {string} name 频道名称
         * @param {string} target 当前页面标识
         * @param {object} [options] 配置项
         * @param {number} [options.retry=3] 发送失败重试次数
         * @param {number} [options.retryInterval=1000] 重试间隔(毫秒)
         */
        constructor(name, target, options = {}) {
            this.name = name;
            this.target = target;
            this.retry = options.retry ?? 3;
            this.retryInterval = options.retryInterval ?? 1000;
            this.evts = {};
            this.pendingResponses = {};
            this.pendingReceives = {};
            // 暂时没人等、但已经到达的消息先放这里，避免两次 receive 之间漏消息
            this.inbox = {};

            // 初始化通信通道
            this.initChannel();
        }

        /* -------------------- 核心通信逻辑 -------------------- */
        initChannel() {
            // 优先使用 BroadcastChannel
            if (typeof BroadcastChannel !== 'undefined') {
                this.setupBroadcastChannel();
            } else {
                this.setupStorageFallback();
            }
            window.addEventListener('beforeunload', () => this.destroy());
        }

        setupBroadcastChannel() {
            this.channelType = 'broadcast';
            this.channel = new BroadcastChannel(this.name);
            this.channel.addEventListener('message', this.handleMessage.bind(this));
            this.channel.addEventListener('messageerror', (e) => {
                this.emitError('MESSAGE_ERROR', '消息解析失败', e);
            });
        }

        setupStorageFallback() {
            this.channelType = 'storage';
            this.storageKey = `web_broadcast_${this.name}`;

            // 监听 storage 事件
            window.addEventListener('storage', (e) => {
                if (e.key === this.storageKey && e.newValue) {
                    const message = JSON.parse(e.newValue);
                    this.handleMessage({ data: message });
                }
            });
        }

        handleMessage(e) {
            const resp = e.data;
            if (![this.target, 'all'].includes(resp.to)) return;

            // 处理事件监听
            if (this.evts[resp.type]) {
                Promise.resolve().then(() => this.evts[resp.type](resp.from, resp.data));
            }

            // 处理 receive 等待
            const receiveKey = `${resp.from}-${resp.type}`;
            if (this.pendingReceives[receiveKey]) {
                const pending = this.pendingReceives[receiveKey];
                pending.resolve(resp.data);
                clearTimeout(pending.timer);
                delete this.pendingReceives[receiveKey];
            } else if (!this.pendingResponses[resp.data?.requestId]) {
                // 没人在等，先缓存起来，等下一次 receive 时优先取用
                this.pushInbox(receiveKey, resp.data);
            }

            // 处理 sendAndReceive 响应
            if (this.pendingResponses[resp.data?.requestId]) {
                const pending = this.pendingResponses[resp.data.requestId];
                pending.resolve(resp.data);
                clearTimeout(pending.timer);
                delete this.pendingResponses[resp.data.requestId];
            }
        }

        /* -------------------- 消息缓存 -------------------- */
        pushInbox(key, data) {
            if (!data || typeof data !== 'object' || data.requestId) return;
            const list = this.inbox[key] || (this.inbox[key] = []);
            list.push({ data, ts: Date.now() });
            if (list.length > 20) list.shift();
        }

        takeInbox(key, maxAge = 120000) {
            const list = this.inbox[key];
            if (!list || !list.length) return null;
            const now = Date.now();
            while (list.length) {
                const item = list.shift();
                if (now - item.ts <= maxAge) return item.data;
            }
            return null;
        }

        clearInbox(from, type) {
            delete this.inbox[`${from}-${type}`];
        }

        /* -------------------- 消息收发方法 -------------------- */
        send(to, type, data = null, attempt = 0) {
            const message = { from: this.target, to, type, data };

            return new Promise((resolve, reject) => {
                try {
                    if (this.channelType === 'broadcast') {
                        this.channel.postMessage(message);
                    } else {
                        // storage 方案需要先写入再删除，触发事件
                        localStorage.setItem(this.storageKey, JSON.stringify(message));
                        localStorage.removeItem(this.storageKey);
                    }
                    resolve();
                } catch (err) {
                    if (attempt < this.retry) {
                        setTimeout(() => this.send(to, type, data, attempt + 1), this.retryInterval);
                    } else {
                        this.emitError('SEND_FAILED', `消息发送失败: ${type}`, err);
                        reject(`消息发送失败: ${type}, ${err.message}`);
                    }
                }
            });
        }

        receive(from, type, timeout = 30000) {
            const key = `${from}-${type}`;
            // 已经到达过的消息优先返回，避免漏收
            const cached = this.takeInbox(key);
            if (cached) return Promise.resolve(cached);
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    reject(new WebBroadcastError('TIMEOUT', `接收超时: ${type}`));
                    delete this.pendingReceives[key];
                }, timeout);

                this.pendingReceives[key] = { resolve, reject, timer };
            });
        }

        sendAndReceive(to, type, data = null, timeout = 30000) {
            const requestId = this.generateRequestId();
            const responseType = `${type}_response`;

            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    reject(new WebBroadcastError('TIMEOUT', `请求超时: ${type}`));
                    delete this.pendingResponses[requestId];
                }, timeout);


                this.pendingResponses[requestId] = { resolve, reject, timer };
                // 发送时携带 responseType
                this.send(to, type, { ...data, requestId, responseType });
            });
        }

        reply(originalFrom, originalType, data, requestId, responseType) {
            const finalResponseType = responseType || `${originalType}_response`;
            return this.send(originalFrom, finalResponseType, { ...data, requestId });
        }

        /* -------------------- 工具方法 -------------------- */
        generateRequestId() {
            const time = Date.now().toString(36);
            const random = Math.random().toString(36).slice(2, 6);
            WebBroadcast.ID_COUNTER = (WebBroadcast.ID_COUNTER + 1) % 0xfff;
            return `${time}-${random}-${WebBroadcast.ID_COUNTER.toString(36).padStart(2, '0')}`;
        }

        emitError(code, message, error) {
            const err = new WebBroadcastError(code, `${message}: ${error?.message || error}`);
            console.error(err);
            if (this.evts['error']) {
                this.evts['error'](code, err.message);
            }
        }

        on(evt, fn) {
            if (typeof fn !== 'function') throw new Error('回调必须是函数');
            this.evts[evt] = fn;
        }

        off(evt) {
            delete this.evts[evt];
        }

        destroy() {
            if (this.channel) {
                this.channel.close();
            }
            window.removeEventListener('storage', this.handleMessage);
            this.pendingResponses = {};
            this.pendingReceives = {};
            this.inbox = {};
        }
    }

    // api请求
    class Api {
        constructor() { }

        /**
         * 封装请求
         * @param {string} path 请求路径
         * @param {string} method 请求方法
         * @param {any} data 请求数据
         * @returns {Promise<any>} 请求结果
         */
        __http(path, method = 'GET', data = null) {
            const start = performance.now();
            return new Promise(async (resolve, reject) => {
                GM.xmlHttpRequest({
                    method: method,
                    url: OPTIONS.serverHost + path,
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    data: data,
                    timeout: 1000 * 60 * 10,
                })
                    .then(resp => {
                        if (resp.status != 200) {
                            banner(`请求失败: ${resp.status}`);
                            reject(resp.status);
                            return;
                        }
                        resolve(JSON.parse(resp.response));
                    })
                    .catch((err) => {
                        banner('请求出错');
                        reject(`请求出错: ${JSON.stringify(err)}`);
                    });
            });
        }

        /**
         * 获取自我介绍
         */
        getIntroduce() {
            return new Promise((resolve, reject) => this.__http('/get-introduce').then(res => {
                resolve(res.introduce);
            }).catch(reject));
        }

        /**
         * 获取标签
         */
        getTags() {
            return new Promise((resolve, reject) => this.__http('/tags').then(res => {
                resolve(res.tags);
            }).catch(reject));
        }

        /**
         * 获取前端运行配置
         */
        getClientConfig() {
            return new Promise((resolve, reject) => this.__http('/client-config').then(resolve).catch(reject));
        }

        /**
         * 获取职位匹配度
         * @param {string} title 职位标题
         * @param {string} salary 薪资范围
         * @param {string} detail 职位描述
         */
        getJobScore(title, salary, detail) {
            const data = `# 职位名称\n${title}\n\n# 薪资范围\n${salary}\n\n# 职位描述\n${detail}`;
            return new Promise((resolve, reject) => {
                this.__http('/get-job-score', 'POST', JSON.stringify(data)).then(resolve).catch(reject);
            });
        }

        /**
         * 回复消息
         * @param {string} msgs 消息记录
         */
        reply(msgs) {
            return new Promise((resolve, reject) => {
                this.__http('/reply', 'POST', JSON.stringify(msgs)).then(res => {
                    resolve(res);
                }).catch(reject);
            });
        }

        /**
         * 判断是否需要简历
         * @param {string} msgs 消息记录
         */
        isNeedResume(msgs) {
            return new Promise((resolve, reject) => {
                this.__http('/is-need-resume', 'POST', JSON.stringify(msgs)).then(res => {
                    resolve(res.need);
                }).catch(reject);
            });
        }

        /**
         * 判断是否需要作品集
         * @param {string} msgs 消息记录
         */
        isNeedWorks(msgs) {
            return new Promise((resolve, reject) => {
                this.__http('/is-need-works', 'POST', JSON.stringify(msgs)).then(res => {
                    resolve(res.need);
                }).catch(reject);
            });
        }

        /**
         * 今日打招呼统计（后端按 job_actions.jsonl 统计）
         */
        getGreetStats() {
            return new Promise((resolve, reject) => this.__http('/greet-stats').then(resolve).catch(reject));
        }

        /**
         * 记录动作日志
         * @param {object} payload 动作信息
         */
        logAction(payload) {
            return new Promise((resolve, reject) => {
                this.__http('/log-action', 'POST', JSON.stringify(payload)).then(resolve).catch(reject);
            });
        }
    }

    // 日志记录
    class Logger {
        constructor(startFn, pauseFn) {
            // 校验函数
            if (startFn && !Function.prototype.isPrototypeOf(startFn)) {
                throw new Error('参数错误，startFn应为函数');
            }
            if (pauseFn && !Function.prototype.isPrototypeOf(pauseFn)) {
                throw new Error('参数错误，pauseFn应为函数');
            }
            // 创建元素
            const ctn = document.createElement('div');
            const btnBox = document.createElement('div');
            const clearBtn = document.createElement('div');
            const runBtn = document.createElement('div');
            const foldBtn = document.createElement('div');
            const msgList = document.createElement('div');
            ctn.style.cssText = `
                position: fixed;
                bottom: 16px;
                left: 16px;
                width: 380px;
                background-color: rgba(0, 0, 0, 0.5);
                color: #fff;
                z-index: 9999;
                font-size: 14px;
                border-radius: 10px;
            `;
            btnBox.style.cssText = `
                width: 380px;
                height: 32px;
                display: flex;
                align-items: center;
                justify-content: flex-end;
            `;
            clearBtn.style.cssText = runBtn.style.cssText = foldBtn.style.cssText = `
                width: 60px;
                height: 32px;
                line-height: 32px;
                text-align: center;
                cursor: pointer;
            `;
            msgList.style.cssText = `
                width: 380px;
                height: 240px;
                padding: 2px 12px 8px;
                overflow-y: auto;
                display: flex;
                flex-direction: column;
                gap: 4px;
            `;
            clearBtn.innerText = "清空";
            runBtn.innerText = "开始";
            foldBtn.innerText = "收起";
            document.body.appendChild(ctn);
            ctn.appendChild(btnBox);
            btnBox.appendChild(clearBtn);
            btnBox.appendChild(runBtn);
            btnBox.appendChild(foldBtn);
            ctn.appendChild(msgList);
            this.ctn = ctn;
            this.list = msgList;
            this.runBtn = runBtn;
            this.clearBtn = clearBtn;
            this.__startFn = startFn || (() => void 0);
            this.__pauseFn = pauseFn || (() => void 0);
            this.__pause = true;
            clearBtn.addEventListener('click', () => this.clear());
            runBtn.addEventListener('click', () => {
                this.__pause = !this.__pause;
                if (this.__pause) {
                    runBtn.innerText = "继续";
                    this.__pauseFn();
                } else {
                    runBtn.innerText = "暂停";
                    this.__startFn();
                }
            });
            foldBtn.addEventListener('click', () => {
                if (foldBtn.innerText === "展开") {
                    msgList.style.height = "240px";
                    foldBtn.innerText = "收起";
                } else {
                    msgList.style.height = "32px";
                    this.list.scrollTop = this.list.scrollHeight;
                    foldBtn.innerText = "展开";
                }
            });
        }

        add(message) {
            const item = document.createElement('div');
            item.textContent = message;
            this.list.appendChild(item);
            this.list.scrollTop = this.list.scrollHeight;
        }

        divider() {
            const item = document.createElement('div');
            item.style.cssText = `
                width: 100%;
                border-top: 1px dashed rgba(255, 255, 255, 0.6);
            `;
            this.list.appendChild(item);
            this.list.scrollTop = this.list.scrollHeight;
        }

        clear() {
            while (this.list.firstChild) {
                this.list.removeChild(this.list.firstChild);
            }
        }

        remove() {
            this.ctn.remove();
        }
    }

    // boss 直聘
    class Zhipin {
        constructor() {
            // 窗口标签
            this.targets = {
                search: "__zhipin_search",
                detail: "__zhipin_detail",
                chat: "__zhipin_chat",
                chatGreet: "__zhipin_chat_greet",
            };
            // 广播类型
            this.bcTypes = {
                // 全局
                STATUS: "status",
                RUN: 'run',
                DIVIDER: 'divider',
                INTRODUCE: 'introduce',
                HEART_BEAT: 'heart-beat',
                // 聊天页和职位详情页
                GET_JOB_INFO: 'get-job-info',
                SAY_HI: 'say-hi',
            };
            // 白名单
            this.whiteList = WHITELIST.zhipin;
            // 记录状态
            this.pause = false;
            this.tags = [];
            this.introduce = ''
        }

        // 注册广播
        __broadcast(target) {
            this.broadcast = new WebBroadcast('__zhipin_broadcast', target);
        }

        // 搜索页
        async __search(tagIdx) {
            // api
            const api = new Api();
            // 记录开始时间
            const start = new Date().getTime();
            let count = 0;
            let greetCount = 0; // 本次已打招呼数量
            let runStartedAt = start; // 本次运行起点（手动继续后会重置）
            // 当天计数：Boss 是“按天”限流的，重启脚本不能重置这个数
            const DAILY_GREET_KEY = '__zhipin_daily_greet';
            const todayStr = () => {
                const d = new Date();
                return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            };
            const readDailyCount = () => {
                try {
                    const rec = JSON.parse(localStorage.getItem(DAILY_GREET_KEY) || '{}');
                    return rec && rec.date === todayStr() ? Number(rec.count) || 0 : 0;
                } catch (e) {
                    return 0;
                }
            };
            const bumpDailyCount = () => {
                const next = readDailyCount() + 1;
                try {
                    localStorage.setItem(DAILY_GREET_KEY, JSON.stringify({ date: todayStr(), count: next }));
                } catch (e) { /* 忽略 */ }
                return next;
            };
            let dailyGreetCount = readDailyCount();
            let page = 0;
            // 记录职位链接
            let jobHrefs = [];
            let elsLen = 0;
            // 缓存
            let started = false;
            let pendingRoundRestart = false;
            let roundTransitioning = false;
            let currentRound = 0;
            let emptyRounds = 0;
            let roundQueuedCount = 0;
            let currentKeyword = '';
            let currentTagIdx = -1;
            const processedJobHrefs = new Set();
            // 从链接里取岗位 id
            const jobIdOf = (href) => {
                const m = String(href || '').match(/job_detail\/([^/.?]+)/);
                return m ? m[1] : String(href || '');
            };
            // 已处理岗位持久化（7 天）：刷新/重启后不再重复投同一个岗位，避免浪费日限
            const PROCESSED_KEY = '__zhipin_processed_jobs';
            const loadProcessedStore = () => {
                try {
                    const raw = JSON.parse(localStorage.getItem(PROCESSED_KEY) || '{}') || {};
                    const cutoff = Date.now() - 7 * 24 * 3600 * 1000;
                    const fresh = {};
                    Object.keys(raw).forEach((k) => {
                        if (Number(raw[k]) > cutoff) fresh[k] = raw[k];
                    });
                    return fresh;
                } catch (e) {
                    return {};
                }
            };
            const processedStore = loadProcessedStore();
            Object.keys(processedStore).forEach((k) => processedJobHrefs.add(k));
            const rememberProcessed = (href) => {
                processedJobHrefs.add(href);
                processedJobHrefs.add(jobIdOf(href));
                processedStore[jobIdOf(href)] = Date.now();
                try {
                    localStorage.setItem(PROCESSED_KEY, JSON.stringify(processedStore));
                } catch (e) { /* 忽略存储失败 */ }
            };
            let lastChatPollAt = 0;
            let chatPolling = false;

            // 日志启动暂停事件
            const logger = new Logger(() => {
                this.pause = false;
                // 手动点“继续”后重新计时、重新计本次数；当日累计不清零（Boss 按天限流）
                greetCount = 0;
                runStartedAt = Date.now();
                if (!started) return main();
                if (pendingRoundRestart) {
                    pendingRoundRestart = false;
                    return startRound();
                }
                loop();
            }, () => {
                this.pause = true;
            });

            // 统一的“停止”出口：把状态置为暂停，并让用户知道为什么停
            const stopProgram = (reason) => {
                this.pause = true;
                logger.divider();
                logger.add(`⏹ 程序已停止：${reason}`);
                logger.add('需要继续就点面板上的「继续」（会重置计数和计时）');
                if (logger.runBtn) logger.runBtn.innerText = '继续';
                logAction({ action: 'program_stopped', scene: 'search', reason });
            };

            // 三个安全阀：打招呼数 / 运行时长 / 轮数
            const hitLimit = () => {
                const hours = (Date.now() - runStartedAt) / 3600000;
                const dailyLimit = Number(OPTIONS.maxGreetsPerDay);
                if (dailyLimit > 0 && dailyGreetCount >= dailyLimit) {
                    stopProgram(`今日已打招呼 ${dailyGreetCount} 个，达到 maxGreetsPerDay=${dailyLimit}（Boss 平台约 150/天上限，留余量防封）`);
                    return true;
                }
                if (Number(OPTIONS.maxGreetsPerRun) > 0 && greetCount >= Number(OPTIONS.maxGreetsPerRun)) {
                    stopProgram(`本次已打招呼 ${greetCount} 个，达到 maxGreetsPerRun=${OPTIONS.maxGreetsPerRun}`);
                    return true;
                }
                if (Number(OPTIONS.maxRunHours) > 0 && hours >= Number(OPTIONS.maxRunHours)) {
                    stopProgram(`已运行 ${hours.toFixed(1)} 小时，达到 maxRunHours=${OPTIONS.maxRunHours}`);
                    return true;
                }
                if (Number(OPTIONS.maxRounds) > 0 && currentRound >= Number(OPTIONS.maxRounds)) {
                    stopProgram(`已完成 ${currentRound} 轮，达到 maxRounds=${OPTIONS.maxRounds}`);
                    return true;
                }
                return false;
            };

            // 开始广播
            const startBroadcast = () => {
                this.__broadcast(this.targets.search);
                // 接收聊天页的消息提醒
                this.broadcast.on(this.bcTypes.STATUS, (from, data) => {
                    if (from === this.targets.chat) {
                        logger.add(data);
                    }
                });
                // 发送自我介绍
                this.broadcast.on(this.bcTypes.INTRODUCE, (from, data) => {
                    this.broadcast.reply(
                        from,
                        this.bcTypes.INTRODUCE,
                        { introduce: this.introduce },
                        data.requestId,
                        data.responseType
                    );
                });
                // 分割线
                this.broadcast.on(this.bcTypes.DIVIDER, () => {
                    logger.divider();
                });
                // 监听打招呼
                greetListener();
                // 监听聊天页
                chatListener();
                // 心跳监听
                heartBeatListener();
            };

            // 执行搜索
            const search = async (kw) => {
                try {
                    const input = await tools.endlessFind(SELECTORS.ZHIPIN.SEARCH.SEARCHINPUT);
                    const btn = await tools.endlessFind(SELECTORS.ZHIPIN.SEARCH.SEARCHBTN);
                    tools.inputText(input, kw);
                    btn.click();
                } catch (e) {
                    logger.add('搜索出错');
                    throw new Error('搜索出错');
                }
            };

            // 获取职位链接
            const getJobHrefs = async (retry = 2) => {
                for (let attempt = 0; attempt <= retry; attempt++) {
                    try {
                        const jobUl = await tools.endlessFind(SELECTORS.ZHIPIN.SEARCH.JOBLIST, 6000);
                        const aList = jobUl.querySelectorAll(SELECTORS.ZHIPIN.SEARCH.JOBHREFS);
                        const hrefs = Array.from(aList)
                            .map(a => a.href)
                            .slice(elsLen)
                            .filter(href => !processedJobHrefs.has(href) && !processedStore[jobIdOf(href)]);
                        return [hrefs, aList];
                    } catch (e) {
                        if (attempt < retry) {
                            await tools.asyncSleep(1500);
                            continue;
                        }
                        // 关键词搜不到结果时列表整个不存在，之前在这里无限抛错重试，会卡很久
                        logger.add('没有找到职位列表（该关键词可能无结果），跳过本轮');
                        return [[], []];
                    }
                }
                return [[], []];
            };

            const resetRoundState = () => {
                jobHrefs = [];
                elsLen = 0;
                page = 0;
                roundQueuedCount = 0;
                clearPendingGreet();
            };

            const activatePreloadCard = async (round) => {
                if (!OPTIONS.preloadActivateCardEvery || round % OPTIONS.preloadActivateCardEvery !== 0) return;
                try {
                    const jobUl = document.querySelector(SELECTORS.ZHIPIN.SEARCH.JOBLIST);
                    if (!jobUl) return;
                    const cards = Array.from(jobUl.querySelectorAll(SELECTORS.ZHIPIN.SEARCH.JOBCARD));
                    if (!cards.length) return;
                    const visibleCards = cards.filter(card => {
                        const rect = card.getBoundingClientRect();
                        return rect.top < window.innerHeight - 120 && rect.bottom > 120;
                    });
                    const targetCard = visibleCards[visibleCards.length - 1] || cards[cards.length - 1];
                    if (!targetCard) return;
                    targetCard.scrollIntoView({ block: 'center', behavior: 'smooth' });
                    await tools.asyncSleep(120);
                    targetCard.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
                    targetCard.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
                    targetCard.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
                    logger.add(`预加载第 ${round} 轮：已轻点左侧岗位卡片`);
                    await tools.asyncSleep(OPTIONS.preloadActivateCardWaitMs);
                } catch (e) {
                    logger.add('预加载时轻点岗位卡片失败，已继续纯滚动');
                }
            };

            // 下一页
            const nextPage = async () => {
                while (true) {
                    let hrefs, els;
                    [hrefs, els] = await getJobHrefs();
                    if (!els.length || els.length === elsLen) {
                        logger.add('没有更多职位了');
                        return false;
                    }
                    elsLen = els.length;
                    els[elsLen - 1].scrollIntoView();
                    page++;
                    logger.add(`开始浏览第 ${page} 页`);
                    if (hrefs.length) {
                        jobHrefs.push(...hrefs);
                        roundQueuedCount += hrefs.length;
                        logger.add(`本页新增 ${hrefs.length} 个未处理岗位`);
                        return true;
                    }
                    logger.add('本页新增岗位都已处理过，继续向下查找');
                    await tools.asyncSleep(OPTIONS.preloadScrollWaitMs);
                }
            };

            document.nextPage = nextPage

            let greetFailStreak = 0; // 连续被平台拒绝的次数
            let loopErrorStreak = 0; // loop 连续异常次数
            let blockStreak = 0; // 连续被风控/访问受限挡住的次数
            let pendingGreetTimer = null;
            let pendingGreetTitle = '';
            let pendingGreetDecision = null;

            const clearPendingGreet = () => {
                if (pendingGreetTimer) {
                    clearTimeout(pendingGreetTimer);
                    pendingGreetTimer = null;
                }
                pendingGreetTitle = '';
                pendingGreetDecision = null;
            };

            const armPendingGreet = (title, decision = null) => {
                clearPendingGreet();
                pendingGreetTitle = title;
                pendingGreetDecision = decision;
                pendingGreetTimer = setTimeout(async () => {
                    const timeoutTitle = pendingGreetTitle;
                    logger.add(`职位 [${timeoutTitle}] 打招呼超时，已跳过`);
                    clearPendingGreet();
                    await logAction({
                        action: 'greet_timeout',
                        scene: 'search',
                        title: timeoutTitle,
                        timeoutMs: OPTIONS.greetTimeout,
                    });
                    loop();
                }, OPTIONS.greetTimeout);
            };

            const handleRoundExhausted = async () => {
                if (roundTransitioning) return;
                roundTransitioning = true;
                try {
                    if (roundQueuedCount === 0) {
                        emptyRounds += 1;
                        logger.add(`第 ${currentRound} 轮没有拿到新岗位（连续空轮 ${emptyRounds}/${OPTIONS.maxEmptyRounds}）`);
                    } else {
                        emptyRounds = 0;
                        logger.add(`第 ${currentRound} 轮已处理完当前加载岗位，准备进入下一轮`);
                    }
                    if (emptyRounds >= OPTIONS.maxEmptyRounds) {
                        logger.add(`连续 ${OPTIONS.maxEmptyRounds} 轮没有新岗位，自动切换到下一个关键词继续挂机`);
                        emptyRounds = 0;
                        return startRound();
                    }
                    await tools.asyncSleep(OPTIONS.roundRestartDelayMs);
                    if (this.pause) {
                        pendingRoundRestart = true;
                        logger.add('当前已暂停，下一轮等待继续');
                        return;
                    }
                    await startRound();
                } finally {
                    roundTransitioning = false;
                }
            };

            const logAction = async (payload) => {
                try {
                    await api.logAction(payload);
                } catch (e) {
                    console.log('logAction failed', e);
                }
            };

            // 中途去聊天页看一次新回复：Boss 回复后由聊天页自动发简历
            const openChatPoll = async () => {
                if (!OPTIONS.autoSendResumeOnReply || chatPolling) return;
                if (this.pause) return;
                const interval = Number(OPTIONS.chatPollIntervalMs) || 0;
                if (interval > 0 && Date.now() - lastChatPollAt < interval) return;
                chatPolling = true;
                lastChatPollAt = Date.now();
                try {
                    logger.add('检查 Boss 新回复…');
                    localStorage.setItem(CHAT_MODE_KEY, CHAT_MODE_POLL);
                    // 丢掉上一次轮询残留的完成信号，否则会立刻“假完成”
                    this.broadcast.clearInbox(this.targets.chat, this.bcTypes.RUN);
                    tools.openTabNSetTimestamp(this.whiteList.chat, this.targets.chat);
                    const timeout = Number(OPTIONS.chatPollTimeout) || 60000;
                    const done = await this.broadcast
                        .receive(this.targets.chat, this.bcTypes.RUN, timeout)
                        .catch(() => null);
                    if (!done) {
                        logger.add(`回复检查超时（>${Math.round(timeout / 1000)}s），继续投岗位`);
                    } else if (done.error) {
                        logger.add('回复检查出错，已跳过本次检查');
                    } else {
                        logger.add('回复检查完成');
                    }
                } catch (e) {
                    logger.add(`回复检查异常: ${e}`);
                } finally {
                    chatPolling = false;
                }
            };

            // 打开详情页并等回传（单次）
            const getJobInfoOnce = async (href) => {
                const hrefKey = jobIdOf(href);
                const detailWin = tools.openTabNSetTimestamp(href, this.targets.detail);
                if (!detailWin) {
                    return { skip: true, skipReason: '详情页被浏览器拦截（请允许 zhipin.com 弹出窗口）' };
                }
                await tools.asyncSleep(OPTIONS.detailOpenWaitMs);
                const deadline = Date.now() + OPTIONS.detailTimeout;
                while (true) {
                    const remain = deadline - Date.now();
                    if (remain <= 0) break;
                    const info = await this.broadcast
                        .receive(this.targets.detail, this.bcTypes.GET_JOB_INFO, remain)
                        .catch(() => null);
                    if (!info) break;
                    // 上一份岗位迟到的回传，丢掉继续等本轮岗位
                    if (info.href && jobIdOf(info.href) !== hrefKey) {
                        logger.add('收到的详情属于上一个岗位，已丢弃并继续等待');
                        continue;
                    }
                    // 详情页自己报错（风控页 / DOM 未就绪 / 解析失败），快速跳过，不等满超时
                    if (info.error) {
                        return { skip: true, skipReason: info.error };
                    }
                    return info;
                }
                return {
                    skip: true,
                    timeout: true,
                    skipReason: `获取职位详情超时（>${(OPTIONS.detailTimeout / 1000).toFixed(0)}s）`,
                };
            };

            // 获取职位信息（超时重试）
            const getJobInfo = async (href) => {
                const retry = Math.max(0, Number(OPTIONS.detailRetry) || 0);
                let last = null;
                for (let attempt = 0; attempt <= retry; attempt++) {
                    if (this.pause) {
                        return { skip: true, skipReason: '当前已暂停，跳过该岗位' };
                    }
                    last = await getJobInfoOnce(href);
                    if (!last.skip) return last;
                    // 只有“超时”值得重试；风控/DOM异常/非立即沟通直接放弃
                    if (!last.timeout) return last;
                    if (attempt < retry) {
                        logger.add(`详情页 ${(OPTIONS.detailTimeout / 1000).toFixed(0)}s 未回传，重试第 ${attempt + 1} 次`);
                        await tools.asyncSleep(500);
                    }
                }
                return last;
            };

            // 添加到聊天列表
            const addToChatList = async (url) => {
                return new Promise((resolve, reject) => {
                    fetch(url)
                        .then(async resp => {
                            if (!(resp.ok && resp.status === 200)) {
                                const bodyText = await resp.text().catch(() => '');
                                logger.add(`boss直聘网络连接出错: status=${resp.status}`);
                                return reject(new Error(`http_${resp.status}:${bodyText.slice(0, 300)}`));
                            }
                            return resp.json();
                        }).then(resp => {
                            if (resp.code === 0) return resolve(resp);
                            const biz = resp?.zpData?.bizData || {};
                            const dialog = biz.chatRemindDialog || {};
                            const title = dialog.title || '';
                            const body = dialog.content || dialog.text || dialog.message
                                || dialog.desc || dialog.subTitle || dialog.tips || '';
                            const snippet = JSON.stringify(dialog || biz || resp).slice(0, 260);
                            const msg = [title, body].filter(Boolean).join(' / ') || resp?.message || '未知错误';
                            logger.add(`打招呼失败: ${msg}`);
                            logger.add(`平台原文: ${snippet}`);
                            reject(new Error(`biz_fail:${msg} || ${snippet}`));
                        }).catch(err => {
                            reject(err instanceof Error ? err : new Error(String(err)));
                        });
                });
            };

            // 打招呼监听
            const greetListener = () => {
                this.broadcast.on(this.bcTypes.SAY_HI, async (from, data) => {
                    if (from !== this.targets.chatGreet) return;
                    // 要自我介绍
                    if (data.requestId) {
                        this.broadcast.reply(
                            from,
                            this.bcTypes.SAY_HI,
                            {
                                introduce: pendingGreetDecision?.introduce || this.introduce,
                                resumeIndex: pendingGreetDecision?.resumeIndex ?? OPTIONS.resumeIndex,
                            },
                            data.requestId,
                            data.responseType
                        );
                        return;
                    }
                    // 告知结果
                    const finalDecision = pendingGreetDecision;
                    const finalTitle = pendingGreetTitle;
                    clearPendingGreet();
                    if (data.success) {
                        greetFailStreak = 0;
                        logger.add(data.verified === false
                            ? '打招呼已发出（页面还没刷新出气泡，稍后可人工确认）'
                            : '打招呼成功');
                        await logAction({
                            action: 'greet_sent',
                            scene: 'search',
                            title: finalTitle,
                            resumeIndex: finalDecision?.resumeIndex ?? OPTIONS.resumeIndex,
                            verified: data.verified ?? null,
                            confirmed: data.confirmed ?? null,
                        });
                    }
                    // 出错了
                    else {
                        logger.add(`打招呼失败`);
                        await logAction({
                            action: 'greet_failed',
                            scene: 'search',
                            title: finalTitle,
                            resumeIndex: finalDecision?.resumeIndex ?? OPTIONS.resumeIndex,
                        });
                    }
                    loop();
                });
            };

            // 聊天页监听
            const chatListener = () => {
                this.broadcast.on(this.bcTypes.RUN, async (from, data) => {
                    if (from !== this.targets.chat) return;
                    // 中途轮询的完成信号：交给 openChatPoll 里的 receive 处理，这里不推进轮次
                    if (data && typeof data === 'object' && data.poll) {
                        return;
                    }
                    if (data) {
                        logger.divider();
                        const hasNext = await nextPage();
                        if (!hasNext) return handleRoundExhausted();
                        loop();
                    } else {
                        logger.add(`消息处理出错，重试中...`);
                        tools.openTabNSetTimestamp(this.whiteList.chat, this.targets.chat);
                    }
                });
            };

            // 心跳监听
            const heartBeatListener = () => {
                this.broadcast.on(this.bcTypes.HEART_BEAT, async (from, data) => {
                    this.broadcast.reply(
                        from,
                        this.bcTypes.HEART_BEAT,
                        { success: true },
                        data.requestId,
                        data.responseType
                    );
                });
            }

            // 循环
            const loop = async () => {
                try {
                    // 如果暂停，则跳过
                    if (this.pause) {
                        logger.add('暂停中...');
                        return;
                    }
                    if (hitLimit()) return;
                    logger.divider();
                    // 判断职位链接是否为空
                    if (jobHrefs.length === 0) {
                        // 判断是否需要代聊天
                        if (OPTIONS.onlyGreet) {
                            const hasNext = await nextPage();
                            if (!hasNext) return handleRoundExhausted();
                            return loop();
                        }
                        logger.add('开始处理聊天消息');
                        tools.openTabNSetTimestamp(this.whiteList.chat, this.targets.chat);
                        return;
                    }
                    // 处理岗位期间，按间隔去聊天页看一次新回复（Boss 回复后自动发简历）
                    await openChatPoll();
                    if (this.pause) {
                        logger.add('暂停中...');
                        return;
                    }
                    // 抽取第一个
                    const href = jobHrefs.shift();
                    const diff = (new Date().getTime() - start) / 1000;
                    // 获取详情
                    logger.add(`| 浏览: ${++count} | 剩余: ${jobHrefs.length} | 平均: ${(diff / count).toFixed(0)}s | 耗时: ${convertTime(diff)} |`);
                    logger.add(`正在获取职位详情`);
                    const jobInfo = await getJobInfo(href);
                    if (jobInfo.skip) {
                        const skipText = String(jobInfo.skipReason || '');
                        // 被风控挡住不是“这个岗位不好”，继续往下点只会让封禁更重，必须停
                        const blocked = /风控|访问受限|验证码|访问异常|操作频繁/.test(skipText);
                        if (blocked) {
                            blockStreak += 1;
                            logger.add(`⚠ 详情页疑似被风控拦截（连续 ${blockStreak} 次）：${skipText}`);
                        } else {
                            blockStreak = 0;
                        }
                        logger.add(`职位跳过: ${skipText}`);
                        await logAction({
                            action: 'job_skip',
                            scene: 'search',
                            href,
                            title: jobInfo.title || null,
                            salary: jobInfo.salary || null,
                            detail: jobInfo.detail || null,
                            reason: jobInfo.skipReason,
                            blocked,
                        });
                        if (blocked && blockStreak >= 3) {
                            return stopProgram(
                                `连续 ${blockStreak} 个岗位被风控拦截，已自动停止。` +
                                '建议至少等 30 分钟再继续；仍被拦就换网络（切手机热点）、重启浏览器，并把投递速度调慢'
                            );
                        }
                        if (blocked) await tools.asyncSleep(5000);
                        return loop();
                    }
                    blockStreak = 0;
                    rememberProcessed(href);
                    // 如果聊过，下一个
                    if (jobInfo.talked) {
                        logger.add(`职位 [${jobInfo.title}] 已经聊过，下一个`);
                        await logAction({
                            action: 'job_already_talked',
                            scene: 'search',
                            title: jobInfo.title,
                            salary: jobInfo.salary,
                        });
                        return loop();
                    }
                    // 否则发送消息计算匹配度
                    logger.add(`开始计算职位 [${jobInfo.title}] 的匹配度`);
                    const decision = await api.getJobScore(jobInfo.title, jobInfo.salary, jobInfo.detail);
                    logger.add(`匹配度: ${decision.score} | 简历索引: ${decision.resumeIndex}`);
                    await logAction({
                        action: 'job_decision_consumed',
                        scene: 'search',
                        title: jobInfo.title,
                        salary: jobInfo.salary,
                        score: decision.score,
                        resumeIndex: decision.resumeIndex,
                    });
                    // 如果分数达到阈值，打个招呼
                    if (decision.score >= OPTIONS.thread) {
                        logger.add(`正在给职位 [${jobInfo.title}] 发送打招呼消息`);
                        await logAction({
                            action: 'greet_queued',
                            scene: 'search',
                            title: jobInfo.title,
                            salary: jobInfo.salary,
                            resumeIndex: decision.resumeIndex,
                            score: decision.score,
                        });
                        // 判断是否有提醒返回
                        addToChatList(jobInfo.addUrl).then(async () => {
                            // 只有平台真的建立了沟通才计数，失败不占当日额度
                            greetCount += 1;
                            dailyGreetCount = bumpDailyCount();
                            const dailyLimitText = Number(OPTIONS.maxGreetsPerDay) > 0 ? `（今日 ${dailyGreetCount}/${OPTIONS.maxGreetsPerDay}）` : '';
                            logger.add(`本次已打招呼 ${greetCount} 个${dailyLimitText}`);
                            await logAction({
                                action: 'chat_open_requested',
                                scene: 'search',
                                title: jobInfo.title,
                                chatUrl: jobInfo.chatUrl,
                                resumeIndex: decision.resumeIndex,
                            });
                            armPendingGreet(jobInfo.title, decision);
                            const greetWin = tools.openTabNSetTimestamp(jobInfo.chatUrl, this.targets.chatGreet);
                            if (!greetWin) {
                                logger.add('打招呼页被浏览器拦截（请允许 zhipin.com 弹窗），跳过');
                                clearPendingGreet();
                                loop();
                            }
                        }).catch(async (err) => {
                            greetFailStreak += 1;
                            await logAction({
                                action: 'greet_queue_failed',
                                scene: 'search',
                                title: jobInfo.title,
                                resumeIndex: decision.resumeIndex,
                                addUrl: jobInfo.addUrl,
                                chatUrl: jobInfo.chatUrl,
                                streak: greetFailStreak,
                                reason: String(err),
                            });
                            clearPendingGreet();
                            const reasonText = String(err);
                            const limitHit = /上限|次数|限制|频繁|稍后再试/.test(reasonText);
                            if (limitHit) {
                                stopProgram(`平台提示触到限额/风控：${reasonText.slice(0, 120)}`);
                                return;
                            }
                            // 连续被拒多半是触到平台限额/风控，继续硬打只会更糟
                            if (greetFailStreak >= 5) {
                                stopProgram(`连续 ${greetFailStreak} 次打招呼被平台拒绝（${String(err).slice(0, 80)}），疑似触到日限或风控`);
                                return;
                            }
                            // 单次被拒也降速，避免连续触发
                            await tools.asyncSleep(3000);
                            loop();
                        });
                    }
                    // 否则下一轮
                    else {
                        await logAction({
                            action: 'job_below_threshold',
                            scene: 'search',
                            title: jobInfo.title,
                            salary: jobInfo.salary,
                            score: decision.score,
                            threshold: OPTIONS.thread,
                            resumeIndex: decision.resumeIndex,
                        });
                        loop();
                    }
                } catch (e) {
                    console.log(e);
                    logger.add(`循环时出错: ${e}`);
                    loopErrorStreak += 1;
                    if (loopErrorStreak >= 3) {
                        loopErrorStreak = 0;
                        logger.add('连续出错，跳过本轮');
                        return handleRoundExhausted();
                    }
                    loop();
                }
            };

            const preloadJobs = async () => {
                logger.add('开始慢速预加载岗位列表');
                let stableRounds = 0;
                let lastCount = 0;
                let lastScrollY = -1;
                let stoppedByCap = false;
                let missingRounds = 0;
                const maxJobs = Math.max(0, Number(OPTIONS.preloadMaxJobs) || 0);
                for (let round = 1; round <= OPTIONS.preloadMaxRounds; round++) {
                    const jobUl = await tools.endlessFind(SELECTORS.ZHIPIN.SEARCH.JOBLIST, 5000).catch(() => null);
                    const currentCount = jobUl ? jobUl.querySelectorAll(SELECTORS.ZHIPIN.SEARCH.JOBHREFS).length : 0;
                    if (!jobUl) {
                        missingRounds += 1;
                        if (missingRounds >= 3) {
                            logger.add('职位列表一直没出现，本轮跳过预加载');
                            break;
                        }
                    } else {
                        missingRounds = 0;
                    }
                    // 岗位数量上限：列表里岗位越多，详情页打开越慢、越容易被风控
                    if (maxJobs && currentCount >= maxJobs) {
                        stoppedByCap = true;
                        break;
                    }
                    window.scrollBy({ top: OPTIONS.preloadScrollPixels, left: 0, behavior: 'smooth' });
                    await tools.asyncSleep(OPTIONS.preloadScrollWaitMs);
                    await activatePreloadCard(round);
                    const afterJobUl = document.querySelector(SELECTORS.ZHIPIN.SEARCH.JOBLIST);
                    const afterCount = afterJobUl ? afterJobUl.querySelectorAll(SELECTORS.ZHIPIN.SEARCH.JOBHREFS).length : currentCount;
                    const afterY = window.scrollY;
                    logger.add(`预加载第 ${round} 轮：岗位 ${currentCount} -> ${afterCount}`);
                    if (afterCount > lastCount || afterY > lastScrollY) {
                        stableRounds = 0;
                    } else {
                        stableRounds += 1;
                    }
                    lastCount = Math.max(lastCount, afterCount);
                    lastScrollY = Math.max(lastScrollY, afterY);
                    if (stableRounds >= OPTIONS.preloadStableRoundsLimit) {
                        logger.add(`预加载结束：连续 ${stableRounds} 轮无新增岗位`);
                        break;
                    }
                }
                if (stoppedByCap) {
                    logger.add(`预加载已到岗位上限 ${maxJobs}，提前结束`);
                }
                const finalJobUl = document.querySelector(SELECTORS.ZHIPIN.SEARCH.JOBLIST);
                const finalCount = finalJobUl ? finalJobUl.querySelectorAll(SELECTORS.ZHIPIN.SEARCH.JOBHREFS).length : 0;
                logger.add(`预加载完成，当前已加载岗位数：${finalCount}`);
                if (finalCount > 150) {
                    logger.add(`提示：岗位数偏多（${finalCount}），详情页会更慢也更容易被风控，建议把 frontend.preloadMaxJobs 调小到 80~120`);
                }
            };

            const pickNextKeyword = () => {
                if (!this.tags || !this.tags.length) {
                    throw new Error('未获取到岗位关键词列表');
                }
                currentTagIdx = (currentTagIdx + 1) % this.tags.length;
                currentKeyword = this.tags[currentTagIdx];
                return currentKeyword;
            };

            const startRound = async () => {
                if (hitLimit()) return;
                resetRoundState();
                currentRound += 1;
                const keyword = pickNextKeyword();
                logger.divider();
                logger.add(`开始第 ${currentRound} 轮`);
                logger.add(`本轮搜索关键词：${keyword}`);
                window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
                await tools.asyncSleep(600);
                await search(keyword);
                // 搜索页本身也可能被风控（“访问受限”），这时继续往下滑只会白白加深封禁
                await tools.asyncSleep(1200);
                const blockedNow = detectBlockPage();
                if (blockedNow) {
                    return stopProgram(
                        `搜索页被风控拦截（${blockedNow}），已自动停止。` +
                        '建议至少等 30 分钟再继续；仍被拦就换网络（切手机热点）、重启浏览器再试'
                    );
                }
                logger.add(`第 ${currentRound} 轮已完成搜索（关键词：${keyword}），请在 ${(OPTIONS.manualFilterWaitMs / 1000).toFixed(0)} 秒内手动选择地区、薪资等筛选条件`);
                await tools.asyncSleep(OPTIONS.manualFilterWaitMs);
                await preloadJobs();
                logger.add(`第 ${currentRound} 轮开始按当前筛选条件扫描岗位（关键词：${keyword}）`);
                loop();
            };

            // 应用后端下发的前端配置（实现在模块作用域，聊天页复用同一份逻辑）
            const applyFrontendConfig = (frontend) => applyFrontendOptions(frontend, (m) => logger.add(m));

            // 主函数
            const main = async () => {
                started = true;
                logger.add('--程序启动--');
                // 开始广播
                startBroadcast();
                // 获取统一配置
                const clientConfig = await api.getClientConfig().catch((e) => {
                    logger.add('获取统一配置失败，将回退旧接口');
                    return null;
                });
                if (clientConfig && clientConfig.frontend) {
                    applyFrontendConfig(clientConfig.frontend);
                    logger.add('获取前端配置成功');
                }
                if (clientConfig && Array.isArray(clientConfig.tags) && clientConfig.tags.length) {
                    this.tags = clientConfig.tags;
                    logger.add('获取标签成功: ' + this.tags.join('、'));
                } else {
                    this.tags = await api.getTags();
                    logger.add('获取标签成功(旧接口): ' + this.tags.join('、'));
                }
                if (typeof tagIdx === 'number' && this.tags.length) {
                    currentTagIdx = ((tagIdx % this.tags.length) + this.tags.length) % this.tags.length - 1;
                }
                // 用后端日志校准当日计数：localStorage 可能被清空，也统计不到历史
                try {
                    const stats = await api.getGreetStats();
                    if (stats && typeof stats.greeted === 'number') {
                        dailyGreetCount = Math.max(dailyGreetCount, stats.greeted);
                        const limit = Number(OPTIONS.maxGreetsPerDay) || 0;
                        logger.add(`今日已在 Boss 建立沟通 ${stats.greeted} 个` + (limit ? `（脚本上限 ${limit}）` : ''));
                    }
                } catch (e) {
                    logger.add('今日沟通数校准失败，按本地计数继续');
                }

                if (clientConfig && typeof clientConfig.introduce === 'string' && clientConfig.introduce) {
                    this.introduce = clientConfig.introduce;
                    logger.add('获取自我介绍成功');
                } else {
                    this.introduce = await api.getIntroduce();
                    logger.add('获取自我介绍成功(旧接口)');
                }
                if (this.introduce && this.introduce.length > 180) {
                    logger.add(`提示：招呼语 ${this.introduce.length} 字，偏长，Boss 首条消息可能被截断，建议控制在 160 字内`);
                }
                await startRound();
            };

            // 初始化
            const init = () => {
                // 如果时间戳小于阈值，直接运行
                if (start - tools.getTimestamp(this.targets.search) < OPTIONS.timestampTimeout) {
                    logger.runBtn.click();
                }
            };

            init();
        }

        // 详情页
        async __detail() {
            // 注册广播
            const startBroadcast = () => {
                this.__broadcast(this.targets.detail);
            };
            startBroadcast();

            const sleep = tools.asyncSleep;

            // 等关键 DOM 就绪：页面没渲染完就读取，会直接抛错并让搜索页干等超时
            const waitReady = async () => {
                const deadline = Date.now() + OPTIONS.detailReadyTimeout;
                while (Date.now() < deadline) {
                    if (document.querySelector(SELECTORS.ZHIPIN.DETAIL.STARTCHAT)) return { ready: true };
                    const nameBox = document.querySelector(SELECTORS.ZHIPIN.DETAIL.NAMEBOX);
                    if (nameBox && nameBox.querySelector(SELECTORS.ZHIPIN.DETAIL.JOBNAME)) return { ready: true };
                    // 职位正文出现也算就绪：网申岗位可能没有“立即沟通”按钮，交给 readJobInfo 判定
                    if (document.querySelector(SELECTORS.ZHIPIN.DETAIL.DETAIL)) return { ready: true };
                    const blocked = detectBlockPage();
                    if (blocked) return { ready: false, error: `详情页被风控拦截（${blocked}），建议降低投递速度` };
                    await sleep(150);
                }
                const blocked = detectBlockPage();
                if (blocked) return { ready: false, error: `详情页被风控拦截（${blocked}），建议降低投递速度` };
                return {
                    ready: false,
                    error: `详情页 ${(OPTIONS.detailReadyTimeout / 1000).toFixed(0)}s 内未渲染出关键元素`,
                };
            };

            // 读取职位信息（任何一步失败都回报 error，保证搜索页能立刻往下走）
            const readJobInfo = () => {
                try {
                    const chatBtn = document.querySelector(SELECTORS.ZHIPIN.DETAIL.STARTCHAT);
                    const nameBox = document.querySelector(SELECTORS.ZHIPIN.DETAIL.NAMEBOX);
                    const titleEl = nameBox && nameBox.querySelector(SELECTORS.ZHIPIN.DETAIL.JOBNAME);
                    const salaryEl = nameBox && nameBox.querySelector(SELECTORS.ZHIPIN.DETAIL.SALARY);
                    const detailEl = document.querySelector(SELECTORS.ZHIPIN.DETAIL.DETAIL);
                    if (!titleEl || !detailEl) {
                        return { error: '详情页结构异常（缺少职位名称或职位描述）', href: location.href };
                    }
                    const title = titleEl.innerText.trim();
                    const salary = salaryEl ? salaryEl.innerText.trim() : '';
                    const detail = detailEl.innerText.trim();
                    const actionText = chatBtn ? chatBtn.innerText.trim() : '';
                    const chatUrl = chatBtn && chatBtn.getAttribute(SELECTORS.ZHIPIN.DETAIL.CHATURL);
                    const addUrl = chatBtn && chatBtn.dataset.url;
                    let skip = false;
                    let skipReason = '';

                    // “继续沟通”= 已经打过招呼的岗位，同样是可沟通状态，不能当成网申跳过
                    const canChat = actionText.indexOf('立即沟通') !== -1 || actionText.indexOf('继续沟通') !== -1;
                    if (!chatBtn) {
                        skip = true;
                        skipReason = '未找到沟通按钮';
                    } else if (!canChat) {
                        skip = true;
                        skipReason = `按钮为 [${actionText || '未知'}]，疑似网申岗位`;
                    } else if (!chatUrl || !addUrl) {
                        skip = true;
                        skipReason = '缺少聊天链接，疑似异常岗位';
                    }

                    return {
                        title,
                        salary,
                        detail,
                        actionText,
                        chatUrl,
                        addUrl,
                        skip,
                        skipReason,
                        // “继续沟通”也说明已经聊过，避免重复打招呼被平台拒
                        talked: !!chatBtn && (chatBtn.dataset.isfriend === 'true'
                            || actionText.indexOf('继续沟通') !== -1),
                        href: location.href,
                    };
                } catch (e) {
                    return { error: `解析详情页失败: ${e && e.message ? e.message : e}`, href: location.href };
                }
            };

            // 主函数：先等页面就绪，再把结果回传；无论成功失败都要回传
            const main = async () => {
                const ready = await waitReady();
                const jobInfo = ready.ready ? readJobInfo() : { error: ready.error, href: location.href };

                // 来源判断：优先按 window.name，其次按聊天页的时间戳
                const fromSearch = window.name === this.targets.detail;
                const fromChat = !fromSearch && Date.now() - tools.getTimestamp(this.targets.chat) < OPTIONS.timestampTimeout;

                if (fromSearch) {
                    await this.broadcast.send(this.targets.search, this.bcTypes.GET_JOB_INFO, jobInfo);
                    return;
                }
                if (fromChat) {
                    await this.broadcast.send(this.targets.chat, this.bcTypes.GET_JOB_INFO, jobInfo);
                    window.close();
                }
            };
            main();
        }

        // 聊天页
        async __chat() {
            // 注册广播
            const startBroadcast = (target = this.targets.chat) => {
                this.__broadcast(target);
            };

            // 动作日志：必须定义在 __chat 作用域，打招呼(sayHi)和聊天(chat)两条链路都要用。
            // 之前只在 chat() 内部定义，sayHi() 引用不到 → ReferenceError → 回执发不出去 → 必然超时。
            const actionApi = new Api();
            const logAction = async (payload) => {
                try {
                    await actionApi.logAction(payload);
                } catch (e) {
                    console.log('logAction failed', e);
                }
            };

            // 发送消息（真正的实现放在后面 sendMsg，这里只保留日志客户端）

            // 校验消息是否真的出现在聊天记录里
            // 忽略空白差异，并允许气泡类名变化：先找自己发的气泡，再退回所有消息文本
            const findMyMsg = (text) => {
                const norm = (str) => (str || '').replace(/\s+/g, '');
                const head = norm(text).slice(0, 8);
                if (!head) return null;
                const mine = Array.from(document.querySelectorAll('.item-myself'));
                const hit = mine.find(el => norm(el.innerText).indexOf(head) !== -1);
                if (hit) return hit;
                const bubbles = Array.from(document.querySelectorAll('.message-content .text, .chat-message .text'));
                return bubbles.find(el => norm(el.innerText).indexOf(head) !== -1) || null;
            };

            // 发送失败时的现场快照，用来区分“真没发出”和“选择器不对”
            const describeChatDom = (ipt) => {
                const mine = document.querySelectorAll('.item-myself').length;
                const friend = document.querySelectorAll('.item-friend').length;
                const texts = Array.from(document.querySelectorAll('.message-content .text'));
                const left = ((ipt && (ipt.innerText || ipt.value)) || '').trim().length;
                const last = texts[texts.length - 1];
                return `自己${mine}/对方${friend}/文本${texts.length}/输入框残留${left}字/末条「${((last && last.innerText) || '').slice(0, 20)}」`;
            };

            const verifyMsgSent = async (text, timeout = 3000) => {
                const deadline = Date.now() + timeout;
                while (Date.now() < deadline) {
                    if (findMyMsg(text)) return true;
                    await tools.asyncSleep(250);
                }
                return false;
            };

            // 把文本真正写进聊天输入框。
            // 只设 innerText 的话，Boss 的编辑器内部状态还是空的，点发送等于没点。
            const fillChatInput = (ipt, text) => {
                ipt.focus();
                if (ipt.isContentEditable) {
                    // 清空已有内容
                    ipt.innerHTML = '';
                    // 首选 execCommand：会触发编辑器的 beforeinput/input，框架能感知到
                    let ok = false;
                    try {
                        ok = document.execCommand('insertText', false, text);
                    } catch (e) {
                        ok = false;
                    }
                    const written = (ipt.innerText || '').replace(/\s+/g, '');
                    if (!ok || written.length < Math.min(4, text.length)) {
                        // 兜底：直接写 + 手动派发 input 事件
                        ipt.innerText = text;
                        const range = document.createRange();
                        range.selectNodeContents(ipt);
                        range.collapse(false);
                        const sel = window.getSelection();
                        sel.removeAllRanges();
                        sel.addRange(range);
                        try {
                            ipt.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
                        } catch (e) {
                            ipt.dispatchEvent(new Event('input', { bubbles: true }));
                        }
                        ipt.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                    return true;
                }
                ipt.value = text;
                ipt.dispatchEvent(new Event('input', { bubbles: true }));
                ipt.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
            };

            const pressEnter = (el) => {
                const opts = { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13, which: 13 };
                el.dispatchEvent(new KeyboardEvent('keydown', opts));
                el.dispatchEvent(new KeyboardEvent('keypress', opts));
                el.dispatchEvent(new KeyboardEvent('keyup', opts));
            };

            const inputEmptied = (ipt) => ((ipt.innerText || ipt.value || '').trim().length === 0);

            const isDisabled = (el) => !el || el.disabled === true || /disabled/.test(el.className || '');

            /**
             * 发送消息：写入 → 点发送（不可用则回车）→ 校验是否真的发出
             * @returns {Promise<{via: string}>} 失败会 throw
             */
            const sendMsg = async (text) => {
                const ipt = await tools.endlessFind(SELECTORS.ZHIPIN.CHAT.CHATINPUT, 8000);
                fillChatInput(ipt, text);
                await tools.asyncSleep(500);

                if (inputEmptied(ipt)) {
                    throw new Error('输入框没写进去（内容为空）');
                }

                let via = 'btn';
                const btn = await tools.endlessFind(SELECTORS.ZHIPIN.CHAT.MSGSEND, 5000).catch(() => null);
                if (btn && !isDisabled(btn)) {
                    btn.click();
                } else {
                    via = 'enter';
                    pressEnter(ipt);
                }
                await tools.asyncSleep(800);

                // 输入框被清空 = 应用已受理；气泡出现 = 更确定的证据
                if (inputEmptied(ipt)) return { via, confirmed: 'cleared' };
                if (await verifyMsgSent(text, 2000)) return { via, confirmed: 'bubble' };

                // 还有内容：换一种发送方式再试一次
                via = 'enter-retry';
                pressEnter(ipt);
                await tools.asyncSleep(900);
                if (inputEmptied(ipt)) return { via, confirmed: 'cleared' };
                if (await verifyMsgSent(text, 2000)) return { via, confirmed: 'bubble' };

                const snapshot = describeChatDom(ipt);
                if (logger) logger.add(`消息发送失败现场: ${snapshot}`);
                throw new Error(`点了发送但消息没出现在聊天记录里（${snapshot}）`);
            };


            // 打招呼
            const sayHi = async () => {
                startBroadcast(this.targets.chatGreet);

                // 心跳 
                let count = 0;
                const loop = () => {
                    this.broadcast.sendAndReceive(
                        this.targets.search,
                        this.bcTypes.HEART_BEAT,
                        { count: ++count }
                    ).then((res) => {
                        if (res.success) {
                            setTimeout(loop, 1000);
                        } else {
                            throw new Error('心跳失联');
                        }
                    }).catch(() => {
                        // 搜索页已经不在（关了/跳走了），停止心跳即可，不再打扰控制台
                    });
                };
                loop();

                let ack = { success: false };
                try {
                    const greetDecision = await this.broadcast.sendAndReceive(this.targets.search, this.bcTypes.SAY_HI);
                    const introduce = greetDecision.introduce;
                    const sent = await sendMsg(introduce);
                    // sendMsg 已确认受理（输入框被清空或气泡已出现），这里再补一次气泡校验
                    const verified = sent.confirmed === 'bubble' || await verifyMsgSent(introduce, 1500);
                    ack = { success: true, verified, confirmed: sent.confirmed };
                    await logAction({
                        action: 'greet_message_sent',
                        scene: 'chat_greet',
                        resumeIndex: greetDecision.resumeIndex ?? OPTIONS.resumeIndex,
                        verified,
                        confirmed: sent.confirmed,
                        via: sent.via,
                        length: (introduce || '').length,
                    });
                } catch (e) {
                    ack = { success: false, reason: String(e) };
                    await logAction({
                        action: 'greet_message_failed',
                        scene: 'chat_greet',
                        reason: String(e),
                    });
                } finally {
                    // 无论成功、失败还是日志报错，都必须回执；否则搜索页只能干等到 greetTimeout
                    this.broadcast.send(this.targets.search, this.bcTypes.SAY_HI, ack).then(() => {
                        this.broadcast.destroy();
                    }).catch(() => {
                        this.broadcast.destroy();
                    });
                }
            };

            // 获取聊天记录信息
            const getChatInfo = async () => {
                const ctn = await tools.endlessFind(SELECTORS.ZHIPIN.CHAT.HISTORYCTN);

                const getMsgs = async () => {
                    const lis = Array.from(ctn.querySelectorAll(SELECTORS.ZHIPIN.CHAT.USEFULMSG));
                    // 提取历史记录
                    const msgs = [];
                    lis.forEach(li => {
                        const role = li.classList.contains('item-friend') ? 'user' : 'assistant';
                        const msgBox = li.querySelector(SELECTORS.ZHIPIN.CHAT.MSGCONTENT);
                        if (!msgBox) return;
                        msgs.push({
                            role,
                            content: msgBox.innerText,
                        });
                    });
                    // 提取简历，作品集状态
                    let needResume = 0;
                    let needWorks = 0;
                    let resumeSended = false;
                    let worksSended = false;
                    let confirmAddr = false;
                    // 判断聊天字眼中是否有相关信息
                    msgs.reverse();
                    let recent = '';
                    for (const msg of msgs) {
                        if (msg.role !== 'user') {
                            break;
                        }
                        recent += msg.content;
                    }
                    msgs.reverse();
                    if (recent.indexOf('简历') !== -1) {
                        needResume = 1;
                    }
                    if (recent.indexOf('作品') !== -1) {
                        needWorks = 1;
                    }
                    // 判断是否有过明确弹窗
                    const rlis = lis.reverse();
                    for (const li of rlis) {
                        if (li.classList.contains('item-myself')) {
                            break;
                        }
                        const bossGreen = li.querySelector('.boss-green');
                        const dialog = li.querySelector('.item-dialog');
                        if (bossGreen) {
                            const t = bossGreen.innerText;
                            if (t.indexOf('我想要一份您的附件简历，您是否同意\n拒绝\n同意') !== -1) {
                                needResume = 2;
                            }
                        } else if (dialog) {
                            const t = dialog.querySelector('.msg-dialog-title').innerText;
                            if (t.indexOf('您是否接受此工作地点?') !== -1) {
                                confirmAddr = true;
                            }
                        }
                    }
                    // 判断是否发过简历
                    const bossGreen = ctn.querySelectorAll('.boss-green');
                    if (bossGreen.length) {
                        bossGreen.forEach(el => {
                            const t = el.innerText;
                            if (t.indexOf('点击预览附件简历') !== -1) {
                                resumeSended = true;
                            }
                        });
                    }
                    return {
                        msgs,
                        needResume,
                        needWorks,
                        resumeSended,
                        worksSended,
                        confirmAddr,
                        talked: !msgs.every(d => d.role === 'user'),
                        jobEl: (await tools.endlessFind(SELECTORS.ZHIPIN.CHAT.JOBEL)).querySelector(SELECTORS.ZHIPIN.CHAT.JOBCITY)
                    };
                };

                const scroll2Top = async () => {
                    if (ctn.scrollTop === 0) return;
                    ctn.scrollTop = 0;
                    await tools.asyncSleep(300);
                    await scroll2Top();
                };

                // 滚动到顶部
                await tools.asyncSleep(300);
                await scroll2Top();
                // 获取聊天记录
                return await getMsgs();
            };

            // ---------- 简历发送：按配置指定简历，而不是平台默认/模板简历 ----------
            const isVisible = (el) => {
                if (!el || !el.getBoundingClientRect) return false;
                const rect = el.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
            };

            const resumeConfig = () => {
                const cfg = (OPTIONS.resume && typeof OPTIONS.resume === 'object') ? OPTIONS.resume : {};
                const legacy = String(OPTIONS.resumeMatch || '').split(',').map(s => s.trim()).filter(Boolean);
                const match = Array.isArray(cfg.match) ? cfg.match.slice() : [];
                const keywords = [cfg.name, ...match, ...legacy]
                    .filter(Boolean)
                    .map(s => String(s).trim())
                    .filter(Boolean);
                return {
                    name: cfg.name || '',
                    keywords: Array.from(new Set(keywords)),
                    exclude: Array.isArray(cfg.exclude) && cfg.exclude.length ? cfg.exclude : ['在线简历', '模板简历'],
                    preferAttachment: cfg.preferAttachment !== false,
                    strict: cfg.strict !== false,
                    followUpText: cfg.followUpText === undefined ? '已发送，请查收' : cfg.followUpText,
                };
            };

            const visiblePanels = () => Array.from(document.querySelectorAll(
                '.panel-resume, .resume-list, .dialog-container, .boss-dialog, .resume-select, .dialog-wrap'
            ))
                .filter(isVisible)
                // 小面板更可能是真正的弹窗，大面板往往是整页容器
                .sort((a, b) => ((a.innerText || '').length - (b.innerText || '').length));

            const allPanels = () => Array.from(document.querySelectorAll(
                '.panel-resume, .resume-list, .dialog-container, .boss-dialog, .resume-select, .dialog-wrap'
            ));

            const panelText = () => visiblePanels().map(el => el.innerText || '').join(' ').replace(/\s+/g, ' ');

            // 找“发送简历”按钮：优先工具栏里带“简历”字样的按钮，找不到再退回旧选择器
            const findResumeSendBtn = () => {
                const btns = Array.from(document.querySelectorAll('.toolbar-btn, .chat-toolbar .btn, .toolbar .btn'));
                const hit = btns.find(el => {
                    const text = `${el.innerText || ''} ${el.getAttribute('title') || ''} ${el.getAttribute('aria-label') || ''}`;
                    return text.indexOf('简历') !== -1;
                });
                return hit || document.querySelector(SELECTORS.ZHIPIN.CHAT.RESUMESEND);
            };

            // 面板里可点的简历项：覆盖 li / 卡片 / radio-label / 纯文本块
            const collectResumeItems = (requireVisible = true) => {
                const items = [];
                const seen = new Set();
                const push = (el) => {
                    if (!el || seen.has(el)) return;
                    if (requireVisible && !isVisible(el)) return;
                    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
                    if (!text || text.length > 120) return;
                    seen.add(el);
                    items.push({ el, text });
                };
                // 后台标签里弹窗可能量出 0 尺寸，requireVisible=false 时不做可见性过滤
                const panels = requireVisible ? visiblePanels() : allPanels();
                for (const panel of panels) {
                    // 1) 单选/复选：取它所在的 label 或父节点
                    panel.querySelectorAll('input[type="radio"], input[type="checkbox"]').forEach((input) => {
                        push(input.closest('label') || input.parentElement);
                    });
                    // 2) 常见列表项
                    panel.querySelectorAll('li, .resume-item, [class*="resume-item"], [class*="resumeItem"], [class*="resume-card"], [class*="resume_card"]').forEach(push);
                    // 3) 兜底：文本像简历名的叶子节点
                    if (!items.length) {
                        panel.querySelectorAll('div, label, a, p').forEach((el) => {
                            if (el.querySelector('div, label, a, p, ul, li')) return;
                            const t = (el.textContent || '').trim();
                            if (!t || t.length > 80) return;
                            if (!/\.(pdf|docx?)\b|在线简历|附件简历|我的简历/i.test(t)) return;
                            push(el);
                        });
                    }
                }
                return items;
            };

            // 弹窗结构快照：标签 + class + 文本，用来定位真实 DOM
            const dumpPanelStructure = (limit = 30) => {
                const iframes = document.querySelectorAll('iframe').length;
                const panels = visiblePanels();
                if (!panels.length) return `无可见弹窗（页面 iframe=${iframes}）`;
                const chunks = panels.slice(0, 2).map((panel, idx) => {
                    const cls = typeof panel.className === 'string' ? panel.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
                    const nodes = [];
                    for (const el of panel.querySelectorAll('*')) {
                        if (nodes.length >= limit) break;
                        const c = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
                        const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
                        if (!c && !t) continue;
                        if (t.length > 32) continue;
                        nodes.push(`${el.tagName.toLowerCase()}${c ? '.' + c : ''}「${t.slice(0, 18)}」`);
                    }
                    return `#${idx} ${panel.tagName.toLowerCase()}.${cls} ` + nodes.join(' | ');
                });
                const focusText = `hasFocus=${document.hasFocus()} hidden=${document.hidden}`;
                return `iframe=${iframes} ${focusText} 面板数=${panels.length} ` + chunks.join(' || ').slice(0, 1400);
            };

            // 简历弹窗现场快照：工具栏按钮、命中的面板、候选简历数量
            const describeResumeUi = () => {
                const toolbar = Array.from(document.querySelectorAll('.toolbar-btn'))
                    .map(el => (el.innerText || '').trim() || el.getAttribute('title') || '(无文字)')
                    .slice(0, 12);
                const panels = ['.panel-resume', '.resume-list', '.dialog-container', '.boss-dialog', '.resume-select', '.dialog-wrap']
                    .filter(sel => document.querySelector(sel));
                return `工具栏[${toolbar.join('|') || '空'}] 面板[${panels.join(',') || '无'}] 简历项${collectResumeItems().length}`;
            };

            // 切到“附件简历”页签
            const switchToAttachmentTab = async () => {
                const allTabs = Array.from(document.querySelectorAll('[role="tab"], .tab-item, .resume-tab, .panel-resume .tab, .dialog-container .tab'));
                const tabs = allTabs.filter(isVisible).length ? allTabs.filter(isVisible) : allTabs;
                const tab = tabs.find(el => /附件/.test(el.textContent || ''));
                if (!tab) return false;
                tab.click();
                await tools.asyncSleep(500);
                return true;
            };

            const findConfirmBtn = () => {
                const panels = visiblePanels().length ? visiblePanels() : allPanels();
                for (const panel of panels) {
                    const btn = panel.querySelector('.btn-sure-v2, .btn-confirm, .btn-primary, .btn-v2');
                    if (btn && isVisible(btn)) return btn;
                    // 按文案兜底：Boss 的“发送”按钮类名不固定
                    const byText = Array.from(panel.querySelectorAll('button, .btn, [role="button"]'))
                        .find(el => /^(发送|确认|确定|发送简历)$/.test((el.innerText || '').trim()) && isVisible(el));
                    if (byText) return byText;
                }
                return document.querySelector(SELECTORS.ZHIPIN.CHAT.RESUMESENDCONFIRM)
                    || document.querySelector(SELECTORS.ZHIPIN.CHAT.RESUMEMODALCONFIRM);
            };

            const closeResumePanel = () => {
                const btn = document.querySelector('.panel-resume .close, .dialog-container .close, .icon-close, .close-icon');
                if (btn) btn.click();
            };

            // 发送后回执校验：聊天记录里出现“点击预览附件简历”才算真的发出去了
            const verifyResumeSent = async (timeout = 3000) => {
                const deadline = Date.now() + timeout;
                while (Date.now() < deadline) {
                    const greens = Array.from(document.querySelectorAll('.boss-green'));
                    if (greens.some(el => (el.innerText || '').indexOf('点击预览附件简历') !== -1)) return true;
                    await tools.asyncSleep(300);
                }
                return false;
            };

            // 同一次运行里发简历失败过的联系人，不再反复重试，避免一直弹窗
            const failedResumeContacts = new Set();

            // 发过简历的记录（跨页面刷新有效）：轮询会反复重载聊天页，靠它保证不重复发送
            const SENT_RESUME_KEY = '__zhipin_resume_sent';
            const sentResumeRecord = () => {
                try {
                    const rec = JSON.parse(localStorage.getItem(SENT_RESUME_KEY) || '{}');
                    return rec && typeof rec === 'object' ? rec : {};
                } catch (e) {
                    return {};
                }
            };
            const markResumeSent = (key) => {
                const rec = sentResumeRecord();
                rec[key] = Date.now();
                const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
                Object.keys(rec).forEach(k => { if (!(rec[k] > cutoff)) delete rec[k]; });
                try {
                    localStorage.setItem(SENT_RESUME_KEY, JSON.stringify(rec));
                } catch (e) { /* 忽略存储失败 */ }
            };

            // 等简历弹窗真正渲染出来：Boss 的弹窗是异步出现的，实测 800ms 时还读不到
            const waitResumePanel = async (timeout = 12000) => {
                const deadline = Date.now() + timeout;
                while (Date.now() < deadline) {
                    if (collectResumeItems().length > 0) return true;
                    // 后台标签里尺寸为 0，用全量面板的文本判断弹窗是否已经出现
                    if (allPanels().some((p) => ((p.textContent || '').indexOf('简历') !== -1))) return true;
                    const text = panelText();
                    if (text && text.indexOf('简历') !== -1) return true;
                    await tools.asyncSleep(250);
                }
                return false;
            };

            // 重新拉一次配置（页面打开时后端没起、后来才启动的场景）
            const reloadConfig = async () => {
                const cfg = await new Api().getClientConfig().catch(() => null);
                if (cfg && cfg.frontend) {
                    applyFrontendOptions(cfg.frontend, (m) => { if (logger) logger.add(m); });
                    return true;
                }
                return false;
            };

            const waitResumeSendBtn = async (timeout = 4000) => {
                const deadline = Date.now() + timeout;
                while (Date.now() < deadline) {
                    const btn = findResumeSendBtn();
                    if (btn) return btn;
                    await tools.asyncSleep(200);
                }
                return null;
            };

            /**
             * 发送简历
             * @returns {{sent: boolean, reason?: string, mode?: string, selectedResumeName?: string, matchedBy?: string}}
             */
            const sendResume = async (resumeIndex = OPTIONS.resumeIndex, options = {}) => {
                const dryRun = !!options.dryRun;
                // 详情页会抢焦点，聊天页可能在后台；弹窗在后台标签里可能量出 0 尺寸
                try { window.focus(); } catch (e) { /* 被浏览器忽略也没关系 */ }
                const cfg = resumeConfig();
                const sendBtn = await waitResumeSendBtn();
                if (!sendBtn) {
                    const snap = describeResumeUi();
                    logger.add('简历按钮没找到，现场: ' + snap);
                    return { sent: false, reason: `未找到“发送简历”按钮（${snap}）`, mode: 'no_button' };
                }
                sendBtn.click();

                const panelReady = await waitResumePanel();
                if (!panelReady) {
                    logger.add('等了 8 秒还没看到简历弹窗，可能没点开或结构变了');
                }
                await tools.asyncSleep(300);

                if (cfg.preferAttachment) {
                    const switched = await switchToAttachmentTab();
                    logger.add(switched ? '已切换到附件简历页签' : '未发现附件简历页签，按当前面板内容继续');
                }

                let items = collectResumeItems();
                for (let i = 0; i < 12 && !items.length; i++) {
                    await tools.asyncSleep(500);
                    items = collectResumeItems();
                }
                if (!items.length) {
                    // 聊天页可能在后台（详情页抢了焦点），弹窗量出 0 尺寸 → 退回不看可见性
                    items = collectResumeItems(false);
                    if (items.length) {
                        logger.add(`按可见性收不到简历项，退回全量收集到 ${items.length} 项（页面可能在后台）`);
                    }
                }
                logger.add('简历列表: ' + (items.map((it, i) => `${i}:${it.text.slice(0, 26)}`).join(' | ') || '(未识别到简历列表)'));
                logger.add('目标简历关键字: ' + (cfg.keywords.join(' / ') || '(未配置)'));
                if (!items.length) {
                    logger.add('弹窗结构: ' + dumpPanelStructure());
                }

                const pool = items.filter(it => !cfg.exclude.some(k => it.text.indexOf(k) !== -1));
                let picked = null;
                let matchedBy = '';

                // 1) 按关键字匹配（name 优先）
                for (const kw of cfg.keywords) {
                    const hit = pool.find(it => it.text.indexOf(kw) !== -1);
                    if (hit) {
                        picked = hit;
                        matchedBy = 'name:' + kw;
                        break;
                    }
                }

                if (picked) {
                    logger.add(`选择简历: ${picked.text.slice(0, 30)} (${matchedBy})`);
                    picked.el.click();
                    await tools.asyncSleep(350);
                } else {
                    // 2) 面板里默认选中的就是目标简历 → 直接确认
                    const text = panelText();
                    const hitKeyword = cfg.keywords.find(kw => text.indexOf(kw) !== -1);
                    const attachEvidence = /\.(pdf|docx?)\b/i.test(text) || text.indexOf('附件') !== -1;
                    if (hitKeyword && (!cfg.preferAttachment || attachEvidence)) {
                        matchedBy = 'panel:' + hitKeyword;
                        logger.add(`简历面板默认已包含目标简历（${hitKeyword}），直接确认`);
                    } else if (cfg.strict) {
                        // 3) 严格模式：宁可不发，也不发错简历
                        const snap = describeResumeUi();
                        const reason = cfg.keywords.length
                            ? `未找到指定简历（关键字: ${cfg.keywords.join(' / ')}）`
                            : '未配置 resume.name / resume.match，且未识别到简历列表';
                        logger.add(reason + '，已放弃本次发送。现场: ' + snap);
                        await logAction({
                            action: 'resume_skip_detail',
                            scene: 'chat',
                            reason,
                            resumeItems: items.map((it) => it.text.slice(0, 40)),
                            panelText: panelText().slice(0, 200),
                            panelStructure: snap.slice(0, 600),
                        });
                        closeResumePanel();
                        return {
                            sent: false,
                            reason,
                            mode: 'skipped',
                            panelSnapshot: snap,
                            items: items.map((it) => it.text.slice(0, 40)),
                        };
                    } else {
                        // 4) 非严格模式：退回序号兜底（老行为）
                        picked = items[resumeIndex] || items[0] || null;
                        matchedBy = picked ? 'index:' + items.indexOf(picked) : 'none';
                        logger.add(`未匹配到指定简历，按兜底策略选择: ${picked ? picked.text.slice(0, 26) : '(无)'} (${matchedBy})`);
                        if (picked) {
                            picked.el.click();
                            await tools.asyncSleep(350);
                        }
                    }
                }

                // 试运行：只打开弹窗、列出候选、不点确认，绝不真的发出去
                if (dryRun) {
                    const target = picked ? picked.text.slice(0, 40) : (panelText().slice(0, 60) || '(未识别)');
                    logger.add(`[试运行] 弹窗内容: ${panelText().slice(0, 120) || '(空)'}`);
                    const drySnap = dumpPanelStructure();
                    logger.add('[试运行] 结构: ' + drySnap);
                    await logAction({
                        action: 'resume_dryrun',
                        scene: 'chat',
                        matchedBy: matchedBy || 'none',
                        target: target.slice(0, 60),
                        resumeItems: items.map((it) => it.text.slice(0, 40)),
                        panelText: panelText().slice(0, 200),
                        panelStructure: drySnap.slice(0, 600),
                    });
                    logger.add(`[试运行] 本应发送: ${target}（${matchedBy || 'panel_default'}）`);
                    closeResumePanel();
                    return {
                        sent: false,
                        dryRun: true,
                        selectedResumeName: target,
                        matchedBy: matchedBy || 'panel_default',
                        reason: '试运行模式，未真正发送',
                    };
                }

                const confirm = findConfirmBtn();
                if (!confirm) {
                    const snap = describeResumeUi();
                    logger.add('没找到确认按钮，现场: ' + snap);
                    return { sent: false, reason: `未找到简历发送确认按钮（${snap}）`, mode: 'no_confirm' };
                }
                confirm.click();
                await tools.asyncSleep(600);
                const verified = await verifyResumeSent(4000);
                if (!verified) {
                    logger.add('已点击发送，但没检测到简历回执，请人工确认是否发出');
                }

                if (cfg.followUpText) {
                    await sendMsg(cfg.followUpText).catch(() => null);
                }

                return {
                    sent: true,
                    verified,
                    mode: items.length ? 'resume_list' : 'panel_default',
                    selectedResumeIndex: picked ? items.indexOf(picked) : -1,
                    selectedResumeName: picked ? picked.text.slice(0, 60) : (panelText().slice(0, 60) || null),
                    matchedBy: matchedBy || 'panel_default',
                };
            };

            // 发送作品集
            const sendWorks = async () => {
                logger.add('sendWks');
            };

            let logger = null;
            // 给搜索页同步状态
            const status = (text) => {
                logger && logger.add(text);
                this.broadcast && this.broadcast.send(
                    this.targets.search,
                    this.bcTypes.STATUS,
                    text
                );
            };
            // 分割线
            const divider = () => {
                logger && logger.divider();
                this.broadcast && this.broadcast.send(this.targets.search, this.bcTypes.DIVIDER);
            };

            // 聊天
            const chat = async () => {
                // api
                const api = new Api();
                // 开始广播
                startBroadcast(this.targets.chat);
                // 获取默认自我介绍（兜底）
                // 搜索页没开时别干等 30 秒，8 秒就放弃（没有招呼语就不在聊天页补发）
                const defaultIntroduce = await this.broadcast
                    .sendAndReceive(this.targets.search, this.bcTypes.INTRODUCE, null, 8000)
                    .then((res) => (res && res.introduce) || '')
                    .catch(() => '');
                // 心跳
                let count = 0;
                const loop = async () => {
                    await this.broadcast.sendAndReceive(
                        this.targets.search,
                        this.bcTypes.HEART_BEAT,
                        { count: ++count }
                    ).then((res) => {
                        if (res.success) {
                            setTimeout(loop, 1000);
                        } else {
                            throw new Error('心跳失联');
                        }
                    });
                };
                loop();

                // 一轮
                let round = 0;
                let lastTop = 0;
                const once = async () => {
                    // 获取联系人列表
                    let empty = false;
                    const ctn = await tools.endlessFind(SELECTORS.ZHIPIN.CHAT.CONTACTLIST).catch(e => {
                        if (document.querySelector(SELECTORS.ZHIPIN.CHAT.CONTACTLISTEMPTY)) {
                            status('当前暂无消息');
                            empty = true;
                        }
                    });
                    if (empty) return;
                    const lis = ctn.querySelectorAll(SELECTORS.ZHIPIN.CHAT.CONTACTLISTITEM);
                    // 遍历新消息
                    for (const ls of lis) {
                        try {
                            // 无新消息
                            if (!ls.querySelector(SELECTORS.ZHIPIN.CHAT.NEWMSGNOTICE)) continue;
                            // 获取联系人信息
                            const name = ls.querySelector(SELECTORS.ZHIPIN.CHAT.USERNAME);
                            const company = name.nextElementSibling.innerText;
                            const contactKey = `${name.innerText}|${company}`;
                            divider();
                            status(`[${company} - ${name.innerText}] 发来一条新消息`);
                            // 进入聊天界面
                            name.click();
                            // 获取聊天记录信息
                            const chatInfo = await getChatInfo();
                            // 如果最新的是我的回复
                            const lastMsg = chatInfo.msgs.slice(-1)[0];
                            if (lastMsg && lastMsg.role === 'assistant') continue;
                            // 如果以前没聊过
                            if (!chatInfo.talked) {
                                localStorage.setItem(this.targets.chat, new Date().getTime());
                                chatInfo.jobEl.click();
                                status(`正在获取职位详情`);
                                const jobInfo = await this.broadcast.receive(this.targets.detail, this.bcTypes.GET_JOB_INFO);
                                // 获取职位匹配度
                                status(`开始计算职位 [${jobInfo.title}] 的匹配度`);
                                // 详情页会自己 window.close()，稍等让焦点回到聊天页再操作简历弹窗
                                await tools.asyncSleep(600);
                                const decision = await api.getJobScore(jobInfo.title, jobInfo.salary, jobInfo.detail);
                                status(`匹配度: ${decision.score} | 简历索引: ${decision.resumeIndex}`);
                                await logAction({
                                    action: 'job_decision_consumed',
                                    scene: 'chat',
                                    title: jobInfo.title,
                                    salary: jobInfo.salary,
                                    score: decision.score,
                                    resumeIndex: decision.resumeIndex,
                                });
                                // 如果分数达到阈值并且未聊过天，打个招呼
                                if (defaultIntroduce && decision.score >= OPTIONS.thread && !chatInfo.msgs.length) {
                                    status(`正在给职位 [${jobInfo.title}] 发送打招呼消息`);
                                    try {
                                        await sendMsg(decision.introduce || defaultIntroduce);
                                        await logAction({
                                            action: 'chat_greet_sent',
                                            scene: 'chat',
                                            title: jobInfo.title,
                                            resumeIndex: decision.resumeIndex,
                                        });
                                        status(`打招呼成功`);
                                    } catch (e) {
                                        await logAction({
                                            action: 'chat_greet_failed',
                                            scene: 'chat',
                                            title: jobInfo.title,
                                            resumeIndex: decision.resumeIndex,
                                            reason: String(e),
                                        });
                                        status(`打招呼失败: ${e}`);
                                    }
                                    continue;
                                }
                                // 未达到阈值，直接下一个
                                else if (decision.score < OPTIONS.thread) {
                                    await logAction({
                                        action: 'chat_rejected_below_threshold',
                                        scene: 'chat',
                                        title: jobInfo.title,
                                        score: decision.score,
                                        threshold: OPTIONS.thread,
                                        resumeIndex: decision.resumeIndex,
                                    });
                                    await sendMsg('不好意思，不太合适哈，祝早日找到合适的人选。')
                                    continue;
                                }
                            }
                            let isChat = true;
                            // 只要对方发来新消息且还没发过简历，就直接发送简历，不再调用大模型聊天
                            const sentBefore = !!sentResumeRecord()[contactKey];
                            if (!chatInfo.resumeSended && !sentBefore) {
                                isChat = false;
                                if (failedResumeContacts.has(contactKey)) {
                                    status('该联系人上次发简历没成功，本次跳过（避免反复弹窗），重启脚本可重试');
                                    continue;
                                }
                                localStorage.setItem(this.targets.chat, new Date().getTime());
                                chatInfo.jobEl.click();
                                status(`正在获取职位详情（用于确定简历）`);
                                const jobInfo = await this.broadcast.receive(
                                    this.targets.detail,
                                    this.bcTypes.GET_JOB_INFO,
                                    OPTIONS.detailTimeout + 5000
                                ).catch(() => null);
                                if (!jobInfo || jobInfo.error || !jobInfo.title || !jobInfo.detail) {
                                    const why = jobInfo?.error || jobInfo?.skipReason || '详情回传超时';
                                    status(`未拿到职位详情（${why}），本次不自动发简历`);
                                    await logAction({
                                        action: 'resume_skip_no_jobinfo',
                                        scene: 'chat',
                                        reason: why,
                                    });
                                    continue;
                                }
                                // 详情页会自己 window.close()，稍等让焦点回到聊天页再操作简历弹窗
                                await tools.asyncSleep(600);
                                const decision = await api.getJobScore(jobInfo.title, jobInfo.salary, jobInfo.detail);
                                status(`检测到新消息，正在发送指定简历`);
                                const resumeResult = await sendResume(decision.resumeIndex);
                                if (!resumeResult.sent) failedResumeContacts.add(contactKey);
                                await logAction({
                                    action: resumeResult.sent ? 'resume_sent' : 'resume_skip',
                                    scene: 'chat',
                                    title: jobInfo.title,
                                    salary: jobInfo.salary,
                                    requestedResumeIndex: decision.resumeIndex,
                                    selectedResumeIndex: resumeResult?.selectedResumeIndex ?? null,
                                    selectedResumeName: resumeResult?.selectedResumeName || null,
                                    resumeMatchedBy: resumeResult?.matchedBy || null,
                                    sendMode: resumeResult?.mode || 'unknown',
                                    verified: resumeResult?.verified ?? null,
                                    reason: resumeResult?.reason || null,
                                    resumeItems: resumeResult?.items || null,
                                    panelSnapshot: resumeResult?.panelSnapshot || null,
                                });
                                if (resumeResult.sent) {
                                    markResumeSent(contactKey);
                                    if (resumeResult.verified === false) {
                                        status('简历已发送，但没检测到回执，请人工确认一次');
                                    } else {
                                        status('简历已发送');
                                    }
                                } else {
                                    status(`简历未发送：${resumeResult.reason}`);
                                }
                            }
                            // 是否需要作品集（当前关闭自动发送，仅保留原入口）
                            if (chatInfo.needWorks && !chatInfo.worksSended) {
                                isChat = false;
                                status('检测到作品集相关消息，当前未开启自动发送作品集');
                            }
                            // 聊天
                            if (isChat) {
                                status('已发过简历，跳过自动聊天');
                            }
                        } catch (e) {
                            status('回复某条消息出错');
                        }
                    }
                    // 向下滚动
                    ctn.scrollTop = 1014 * ++round;
                    await tools.asyncSleep(300);
                    if (ctn.scrollTop !== lastTop) {
                        lastTop = ctn.scrollTop;
                        await once();
                    }
                };
                // 完成一轮
                await once();
            };

            // 手动测试入口：在 Boss 聊天页点油猴图标，菜单里选“测试发送指定简历”
            if (typeof GM_registerMenuCommand === 'function') {
                // 试运行：只打开弹窗看有哪些简历、会选中哪个，不点确认，不会真发
                GM_registerMenuCommand('① 检查简历弹窗（不发）', async () => {
                    // sendResume 内部会写 logger，这里必须先确保它存在
                    if (!logger) logger = new Logger();
                    logger.add('=== 试运行：检查简历弹窗 ===');
                    await reloadConfig();
                    const result = await sendResume(OPTIONS.resumeIndex, { dryRun: true });
                    logger.add(result.dryRun
                        ? `✅ 链路正常，本应发送：${result.selectedResumeName}（${result.matchedBy}）`
                        : `⚠️ 链路有问题：${result.reason}`);
                });
                // 真实发送：会真的把简历发给当前会话
                GM_registerMenuCommand('② 真的给当前会话发简历', async () => {
                    if (!logger) logger = new Logger();
                    logger.add('=== 真实发送简历 ===');
                    await reloadConfig();
                    const result = await sendResume();
                    logger.add(result.sent
                        ? `✅ 已发送：${result.selectedResumeName || '(未识别名称)'}（${result.confirmed || result.mode}）`
                        : `❌ 未发送：${result.reason}`);
                });
            }

            // 主函数
            const main = async () => {
                // 聊天页自己也要拉一次配置：resume.match 只存在后端，
                // 不拉的话 OPTIONS.resume 是空数组，严格模式永远“未配置”而放弃发送。
                const bootLogs = [];
                const bootConfig = await new Api().getClientConfig().catch(() => null);
                if (bootConfig && bootConfig.frontend) {
                    applyFrontendOptions(bootConfig.frontend, (m) => bootLogs.push(m));
                }

                // 判断来源
                const now = new Date().getTime();
                const isGreet = now - tools.getTimestamp(this.targets.chatGreet) < OPTIONS.timestampTimeout && window.name === this.targets.chatGreet;
                const isChat = now - tools.getTimestamp(this.targets.chat) < OPTIONS.timestampTimeout && window.name === this.targets.chat;

                if (isGreet) {
                    sayHi();
                }
                else if (isChat) {
                    // 这次是“中途轮询”还是“轮次结束处理”
                    const isPoll = localStorage.getItem(CHAT_MODE_KEY) === CHAT_MODE_POLL;
                    localStorage.removeItem(CHAT_MODE_KEY);
                    // 日志
                    logger = new Logger();
                    logger.runBtn.remove();
                    logger.clearBtn.remove();
                    bootLogs.forEach((m) => logger.add(m));
                    // 等待加载
                    await tools.asyncSleep(3000);
                    chat()
                        .then(async () => {
                            status('消息处理完毕');
                            await this.broadcast.send(
                                this.targets.search,
                                this.bcTypes.RUN,
                                isPoll ? { poll: true } : true
                            );
                        })
                        .catch(async () => {
                            status('聊天程序运行出错');
                            await this.broadcast.send(
                                this.targets.search,
                                this.bcTypes.RUN,
                                isPoll ? { poll: true, error: true } : false
                            );
                        }).finally(() => {
                            this.broadcast.destroy();
                        });
                }
            };
            main();
        }

        // 运行
        run(tagIdx = 0) {
            const path = location.pathname;
            // 在搜索页
            if (path.startsWith(SEARCHPATH.zhipin)) {
                this.__search(tagIdx);
            }
            // 在详情页
            else if (path.startsWith(this.whiteList.deatil)) {
                this.__detail();
            }
            // 在聊天页
            else if (path.startsWith(this.whiteList.chat)) {
                this.__chat();
            }
            // 否则跳转搜索页
            else {
                new Logger(() => {
                    tools.openTabNSetTimestamp(SEARCHPATH.zhipin, this.targets.search, true);
                });
            }
        }
    }

    const goodjobs = new Zhipin().run();
})();
