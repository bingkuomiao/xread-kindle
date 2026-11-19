// 配置 - 从外部配置文件读取
var config = window.READER_CONFIG || {
    type: "multi",
    address: "",
    username: "",
    password: "",
    salt: "",
    contentFontSize: 47,
    lineHeight: 1.3,
    fontFamily: "系统",
    fontWeight: "normal",
    letterSpacing: 7,
    menuFontSizeRatio: 0.5,
    currentClickFunNum: 4,
    debugMode: false,
    debugLevel: 0
};

// 服务器类型不再由用户选择：直接沿用 fpk 安装向导的「多用户鉴权 (SECURE)」。
// cmd/main 每次启动会把 SECURE 注入 /xread/index.html 的 window.__XREAD_CONFIG__：
//   SECURE=true  -> "multi"  （服务器多用户，需登录）
//   SECURE=false -> "single" （服务器单用户，免登录）
// 未走 fnOS 生命周期脚本（例如独立静态部署）时，回退到 config.js 里的 type 默认值。
(function () {
    var rc = window.__XREAD_CONFIG__;
    if (!rc || typeof rc.secure === "undefined") return;
    var secure = rc.secure;
    if (typeof secure === "string") {
        secure = secure !== "false" && secure !== "0" && secure !== "no" && secure !== "off";
    }
    config.type = secure ? "multi" : "single";
})();

// r39-3) 正文字号默认值按「是否 Kindle」区分（不再用视口宽度，PC 宽屏也要 21px）：
//   Kindle PW7（html 无 xread-browser class）维持原默认 47px（大屏大字）；
//   非 Kindle 浏览器（手机/PC，html 有 xread-browser class）默认 21px。
//   UA 检测脚本在 head 最先执行并加 class，此处一定能读到。
//   config 每次从 config.js 读取、无本地持久化，故此默认值每次加载稳定生效；
//   用户在设置页改动后由 applyFontSettings 即时生效，不受此处影响。
(function () {
    var html = document.documentElement;
    var isBrowser = html.className && html.className.indexOf("xread-browser") !== -1;
    if (isBrowser && config.contentFontSize === 47) {
        config.contentFontSize = 21;
    }
})();

// 登录/注册模式：底部「注册」入口复用同一张表单，只切换标题/按钮文字，
// 不新增输入框，保持 Kindle 老浏览器的表单结构最简单。
var loginMode = "login"; // "login" | "register"

// 按 id 就地改文字（不替换元素本身，initEventListeners 绑定的点击事件不会丢）
function setLoginText(id, text) {
    var el = document.getElementById(id);
    if (el) el.innerHTML = text;
}

// 页面内提示条：登录异常/翻页失败用可见文字代替 alert（老 Kindle 上 alert 常被拦截或看不到原因）
function showNotice(id, message) {
    var el = document.getElementById(id);
    if (!el) { if (message) alert(message); return; }
    if (!message) { el.innerHTML = ""; el.style.display = "none"; return; }
    el.innerHTML = message;
    el.style.display = "block";
}
function showLoginError(message) { showNotice("loginError", message); }
function clearLoginError() { showNotice("loginError", ""); }

// 「没有账号？注册」<->「已有账号？登录」
function toggleLoginMode() {
    clearLoginError();
    if (loginMode === "login") {
        loginMode = "register";
        setLoginText("loginTitle", "注册");
        setLoginText("loginSubtitle", "创建账号以同步你的阅读数据");
        setLoginText("loginSubmit", "注册");
        setLoginText("loginFooterText", "已有账号？");
        setLoginText("loginToggle", "登录");
    } else {
        loginMode = "login";
        setLoginText("loginTitle", "登录");
        setLoginText("loginSubtitle", "登录以同步你的阅读数据");
        setLoginText("loginSubmit", "登录");
        setLoginText("loginFooterText", "没有账号？");
        setLoginText("loginToggle", "注册");
    }
}

// 接口配置
var login_url = "login",
    logout_url = "logout",
    chapterList = "getChapterList",
    bookContent = "getBookContent",
    bookshelf = "getBookshelf",
    saveBookProgress = "saveBookProgress",
    // xread-fpk 没有 searchBookSource 路由，使用等价的 getAvailableBookSource 替代
    searchBookSource = "getAvailableBookSource",
    setBookSource = "setBookSource",
    deleteBook = "deleteBook",
    // 书籍分组：后端已有接口，用于把当前书籍移动到已有分组（0 = 未分组）
    getBookGroups = "getBookGroups",
    saveBookGroupId = "saveBookGroupId",
    // 服务端整书缓存（SSE 进度流），用于「缓存书籍」加速
    cacheBookSSE = "cacheBookSSE",
    // 清除服务端整书缓存
    deleteBookCache = "deleteBookCache";
// 缓存数据
var screenWidth = window.screen.width,    // 屏幕宽度
    screenHeight = window.screen.height,  // 屏幕高度
    accessToken = "",                     // 身份令牌
    loadingP = "",                        // 加载等待
    bookSourceMapCache = [],              // 书源列表缓存
    currentSourceUrl = "",                // 当前书源索引
    lastSourceIndex = 0,                  // 当前书源位置
    hasMoreSource = false,                // 服务端是否还有更多书源
    sourceFetching = false,               // 书源列表是否正在请求
    bookChapterMapCache,                  // 章节列表缓存
    currentChapterIndex = null,           // 当前章节索引
    currentChapterPos = null,             // 当前章节阅读位置
    preChapterContent = null,             // 上一章节内容
    currentChapterContent = null,         // 当前章节内容
    nextChapterContent = null,            // 下一章节内容
    currentBookPage = 1,                  // 当前文本页码
    currentBookTotalPage = 1,             // 当前文本总页码
    pageList = [],                        // 页码和内容对应关系
    isComicMode = false,                  // 漫画模式：一张图一页
    bookContentHeight,                    // 页面高度
    currentBookUrl = "",                  // 当前书籍URL
    currentBookName = "",                 // 当前书籍名称
    currentAuthor = "",                   // 当前书籍作者
    menusVisible = false;                 // 顶部和底部菜单显示状态
// 性能优化配置
var showChapterListNum = 16,             // 目录显示的数量
    showSourceListNum = 10,              // 书源显示的数量
    currentSourcePage = 1,               // 当前书源页码
    totalSourcePages = 1,                // 书源总页数
    sourcePageSize = 10,                 // 每页显示书源数量
    sourceBatchSize = 30,                // 单次向服务端请求的书源条数
    preloadCount = 16,                   // 最大预加载章节数，显示数目一半
    preloadedChaptersMapCache = {},      // 预加载缓存对象 - 存储已预加载的章节索引和内容 
    preloadTimer = null,                 // 限制预加载频率和数量
    lastPageTurnDirection = 0,           // 0=管理, 1=向下翻页, -1=向上翻页
    enablePreload = true;                // 是否启用预加载
// 在性能优化配置部分添加滚动计数变量
var lazyCoversCount = 8,                 // 预加载图片数量
    lazyLoadedCovers = {},
    lazyLoadInitialized = false,
    lazyScrollCount = 0,                 // 滚动次数计数
    lazyScrollThreshold = 3;             // 滚动阈值，达到此值后强制加载图片
// DOM元素引用
var contentElement = null,
    textMeasurer = null,
    menuElement = null,
    topMenu = null,
    bottomMenu = null,
    chapterColumn1 = null,
    chapterColumn2 = null,
    sourceColumn1 = null,
    sourceColumn2 = null;

// 返回「加载本页面的源」(http://host:port)，兼容老 Kindle 浏览器
// —— 老 WebKit 没有 window.location.origin，只能用 protocol + host 拼接
function pageOrigin() {
    return window.location.protocol + "//" + window.location.host;
}

// 解析 API 基地址（同源自适应，便于 XRead-kindle 挂在 /xread 子路径、在 7777/7778 等任意端口复用同一后端）
// - address 为空 → 使用页面所在源（http://host:port），API 自动指向同源的 /reader3/...
// - address 为完整 http(s) URL → 原样使用
// - address 仅 host:port（登录框可能只填这项）→ 补上当前协议
// - address 以 / 开头 → 作为根相对路径
function apiBase() {
    var a = config.address;
    if (!a) return pageOrigin();
    if (/^https?:\/\//i.test(a)) return a.replace(/\/+$/, "");
    if (a.charAt(0) === "/") return a.replace(/\/+$/, "");
    return window.location.protocol + "//" + a.replace(/\/+$/, "");
}

function url(router, data) {
    if (config.type == "app") {
        router += "?v=" + new Date().getTime() + "&accessToken=" + accessToken;
    } else if (config.type == "single") {
        router += "?v=" + new Date().getTime();
    } else if (config.type == "multi"){
        router += "?v=" + new Date().getTime() + "&accessToken=" + accessToken;
    } else {
        alert('服务器类型设置失败！');
    }

    if (data) {
        for (var key in data) {
            // 用 encodeURIComponent，避免书名/作者中的 & = # 破坏 query 结构
            router += "&" + key + "=" + encodeURIComponent(data[key]);
        }
    }

    if (config.type == "app") {
        router = "/" + router;
    } else {
        router = "/reader3/" + router;
    }
    return apiBase() + router;
}

// 字符串全局替换
String.prototype.replaceAll = function(search, replacement) {
    var target = this;
    return target.replace(new RegExp(search, "g"), replacement);
};

// 获取单个DOM元素
function $(selector) {
    return document.querySelector(selector);
}

// 获取多个DOM元素
function $$(selector) {
    return document.querySelectorAll(selector);
}

// 显示元素
function show(selector) {
    var element = typeof selector === 'string' ? $(selector) : selector;
    if (element) element.style.display = "block";
}

// 隐藏元素
function hide(selector) {
    var element = typeof selector === 'string' ? $(selector) : selector;
    if (element) element.style.display = "none";
}

// 刷新屏幕显示（闪烁效果）
function freshScreen(selector) {
    show(selector);
    setTimeout(function() {
        hide(selector);
    }, 100);
}

function freshPage() {
    location.reload(true);
}

function addZero(i) {
  if (i < 10) {
    i = "0" + i;
  }
  return i;
}

//格式化时间戳
function formatTime(patten, time) {
  var currentDate = time ? new Date(time) : new Date();
  var formattedTime;
  
  formattedTime = patten.replace("yyyy", currentDate.getFullYear());// 获取年
  formattedTime = formattedTime.replace("MM", addZero(currentDate.getMonth() + 1));//获取月份，1 月为 0
  formattedTime = formattedTime.replace("dd", addZero(currentDate.getDate()));// 获取日
  formattedTime = formattedTime.replace("HH", addZero(currentDate.getHours()));//获取当前小时数(0-23)
  formattedTime = formattedTime.replace("mm", addZero(currentDate.getMinutes()));//获取当前分钟数(0-59)
  formattedTime = formattedTime.replace("ss", addZero(currentDate.getSeconds())); //秒

  return formattedTime;
}

// 中文数字映射表
var chineseToNum = {
    '零':0, '一':1, '二':2, '两':2, '三':3, '四':4,
    '五':5, '六':6, '七':7, '八':8, '九':9,
    '十':10, '百':100, '千':1000, '万':10000
};

// 转换中文数字为阿拉伯数字（≤10000）
function convertChineseNumber(str) {
    var num = 0, section = 0;
    for (var i = 0; i < str.length; i++) {
        var c = str[i];
        var val = chineseToNum[c];
        
        if (val === 10000) {
            num += (section || 1) * val;
            section = 0;
        } else if (val >= 10) {
            section = (section || 1) * val;
            num += section;
            section = 0;
        } else {
            section = (section || 0) + val;
        }
    }
    return Math.min(num + (section || 0), 10001);
}

// 过滤并优化章节标题
function formatChapterTitle(title) {
    if (!title) return "";
    
    var filteredTitle = title
        // 第一步：移除非法字符，保留中文、字母、数字和常用标点
        .replace(/[^\u4e00-\u9fa5a-zA-Z0-9\s,：；。！？（）【】｛｝《》""''、]/g, '')
        // 第二步：规范化空格（多个空格合并为一个）
        .replace(/\s+/g, ' ')
        // 第三步：去除首尾空格
        .trim();
    
    // 第四步：转换中文数字章节（如果有）
    if (filteredTitle) {
        filteredTitle = filteredTitle.replace(
            /第([零一二两三四五六七八九十百千万]+)章/g,
            function(match, numStr) {
                var num = convertChineseNumber(numStr);
                // 只转换10000以内的数字，避免错误转换
                return num <= 10000 ? "第" + num + "章" : match;
            }
        );
    }
    
    return filteredTitle || title; // 如果过滤后为空，返回原标题
}

// 章节内容格式化函数 
function formatChapterContent(content) {
    var indentSpaces = "　　"; // 缩进空格（两个全角空格）
    if (!content) {
        return content;
    }

    // 后端正文可能是纯文本，也可能带 HTML 换行/段落标签。
    // 先统一归一化为 \n，否则整段会被当成「一行」，残留的 <br> 在渲染时
    // 变成连续换行，正文里就会出现大面积空白行。
    var normalized = content
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p\s*>/gi, "\n")
        .replace(/<p[^>]*>/gi, "")
        .replace(/&nbsp;|&#160;/gi, " ")
        .replace(/\r/g, "");

    var lines = normalized.split("\n");
    var formattedLines = [];
    for (var i = 0; i < lines.length; i++) {
        // Kindle WebKit 534 的 trim() 不识别全角空格(U+3000)/不间断空格(\u00A0)，
        // 纯空白行会被当成正文段落渲染成整行空白，故显式去除。
        var line = lines[i].replace(/\t/g, " ").replace(/^[\s\u3000\u00A0]+|[\s\u3000\u00A0]+$/g, "");
        // 去掉所有空行（含仅由空格/全角空格构成的行）
        if (line === "") {
            continue;
        }
        if (line.indexOf(indentSpaces) !== 0) {
            line = indentSpaces + line;
        }
        formattedLines.push(line);
    }
    return formattedLines.join("\n");
}

//获取字符串
function getValue(str) {
    return str ? formatChapterTitle(str.trim()) : "";
}

//更新时间 时分
function freshTime() {
  //$("#nowTime").textContent = formatTime("HH:mm");
}

// 转圈动画已取消：登录按钮下方的 loading.gif 不再引入。
// 保留 loading()/loadingOver() 为空实现，供 HttpGet/HttpPost 等既有调用点继续使用，
// 不再显示或隐藏任何加载动画元素。
function loading() {
}

function loadingOver() {
}

//待实现
function decode(password) {
  return password;
}

function encode(password) {
  return password;
}

// 预加载专用日志
function preloadLog(message, data) {
    // 生产环境完全禁用
    if (!config.debugMode) return;
    // 只在调试级别足够时输出
    if (config.debugLevel < 2) return;
    if (console && console.log) {
        if (data) {
            console.log('[Preload] ' + message, data);
        } else {
            console.log('[Preload] ' + message);
        }
    }
}
// 缓存状态日志（重要信息，级别3）
 function cacheLog(message) {
    if (!config.debugMode) return;
    if (config.debugLevel < 3) return;
    if (console && console.log) {
        console.log('[Cache] ' + message);
    }
}

// 错误日志（始终记录）
function errorLog(message) {
    if (!config.debugMode) return;
    if (console && console.error) {
        console.error(message);
    }
}

// 从非200响应体中提取后端给出的具体错误原因（后端 BadRequest 返回 400 + {isSuccess:false,errorMsg:"..."}）
function extractErrorMsg(xhr) {
    if (xhr.status === 0) return "无法连接服务器，请检查网络或地址";
    var msg = "";
    try {
        var body = JSON.parse(xhr.responseText);
        if (body && body.errorMsg) msg = String(body.errorMsg);
    } catch (e) {}
    return msg ? msg : ("服务器返回错误（" + xhr.status + "）");
}

function HttpGet(url, callback, onError) {
    loading();
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.onreadystatechange = function() {
        if (xhr.readyState === 4) {
            if (xhr.status === 200) {
                try {
                    var data = JSON.parse(xhr.responseText);
                    if (callback) callback(data);
                } catch (e) {
                    console.error("JSON解析错误:", e);
                    loadingOver();
                    if (onError) onError("服务器返回的数据异常");
                }
            } else {
                console.error("Request failed with status: " + xhr.status);
                loadingOver();
                if (onError) onError(extractErrorMsg(xhr));
            }
        }
    };
    
    if (config.type == "multi") {
        xhr.withCredentials = true;
    }
    
    xhr.send();
}

function HttpPost(url, data, callback, onError) {
    loading();
    var xhr = new XMLHttpRequest();
    xhr.open('POST', url, true);
    xhr.setRequestHeader('Content-Type', 'application/json;charset=utf-8');
    
    xhr.onreadystatechange = function() {
        if (xhr.readyState === 4) {
            if (xhr.status === 200) {
                try {
                var response = JSON.parse(xhr.responseText);
                if (callback) callback(response);
                } catch (e) {
                    console.error("JSON解析错误:", e);
                    loadingOver();
                    if (onError) onError("服务器返回的数据异常");
                }
            } else {
                console.error("Request failed with status: " + xhr.status);
                loadingOver();
                if (onError) onError(extractErrorMsg(xhr));
            }
        }
    };
    
    if (config.type == "multi") {
        xhr.withCredentials = true;
    }
    
    xhr.send(JSON.stringify(data));
}

// 替代 closest 的兼容方法
function findParentWithClass(element, className) {
    while (element && element !== document) {
        if (element.classList && element.classList.contains(className)) {
            return element;
        }
        element = element.parentElement;
    }
    return null;
}

//书架排序
function sortByDurChapterTime(books) {
    var arr = [];
    var i = 0;
    var length = books.length;
    while (i < length) {
        var max;
        var max_index = 0;
        for (var index = 0; index < books.length; index++) {
            var book = books[index];
            if (index == 0) {
                max = book;
            } else {
                if (max.durChapterTime < book.durChapterTime) {
                    max = book;
                    max_index = index;
                }
            }
        }
        arr.push(max);
        books.splice(max_index, 1);
        i++;
    }
    return arr;
}

function setTitle(bookName, chapterName) {
  $("#titleAndChapter").textContent = chapterName;
}

function setContentPageInfo() {
  $("#contentPageInfo").textContent = "第" +
    currentBookPage + "/" + currentBookTotalPage+ "页";
}

 // 清除书籍缓存数据
function freshBookCache() {
    // 重置缓存数据
    preloadedChaptersMapCache = {};      // 初始化预加载缓存
    preloadTimer = null;                 // 限制预加载频率和数量
    lastPageTurnDirection = 0;           // 0=未知, 1=向下翻页, -1=向上翻页
    bookSourceMapCache = [];
    lastSourceIndex = 0;
    hasMoreSource = false;
    sourceFetching = false;
    sourceColumn1.innerHTML = "";
    sourceColumn2.innerHTML = "";

    bookChapterMapCache = null;
    currentChapterIndex = null;
    currentChapterPos = null;
    currentChapterContent = null;
    nextChapterContent = null;
    chapterColumn1.innerHTML = "";
    chapterColumn2.innerHTML = "";
    currentBookPage = 1;
    currentBookTotalPage = 1;
    currentBookUrl = "";
    currentBookName = "";
    currentAuthor = "";
    lazyLoadedCovers = {};
    lazyLoadInitialized = false;
    lazyScrollCount = 0;
}

//书籍项创建函数（用于书架）
function createBookItemElement(book, index) {
    // ES5 兼容：老 Kindle WebKit 534 对块级常量声明支持有缺陷，点书架执行到此处会抛异常，统一用 var。
    var bookItem = document.createElement('div');
    bookItem.className = 'book-item';
    
    // 处理封面URL
    var coverUrl = book.coverUrl;
    if (book.customCoverUrl) {
        coverUrl = book.customCoverUrl;
    }

    if (!coverUrl) {
        coverUrl = "img/noCover.jpg";
    } else if (coverUrl.indexOf('http') !== 0) {
        coverUrl = apiBase() + coverUrl;
    }
    
    // 构建书籍项HTML结构
    bookItem.innerHTML = 
        "<img class='coverUrl lazy-cover' " +
        "src='" + "img/cover.jpg" + "' " +
        "data-src='" + coverUrl + "' " +
        "alt='" + (book.name || '') + "'>" +
        "<div class='book-info'>" +
        "<p class='bookNo c_un_show'>" + (index + 1) + "</p>" +
        "<p class='bookname'>" + (book.name || '') + "</p>" +
        "<p class='bookUrl c_un_show'>" + book.bookUrl + "</p>" +
        "<p class='sourceUrl c_un_show'>" + book.origin + "</p>" +
        "<p class='author'>作者:" + (book.author || '') + "</p>" +
        "<p class='totalChapterNum'>总计:共" + (book.totalChapterNum || 0) + "章</p>" +
        "<p class='durChapterTitle'>已读:" + getValue(book.durChapterTitle) + "</p>" +
        "<p class='durChapterIndex c_un_show'>" + (book.durChapterIndex || 0) + "</p>" +
        "<p class='durChapterPos c_un_show'>" + (book.durChapterPos || 0) + "</p>" +
        "<p class='latestChapterTitle'>最新:" + getValue(book.latestChapterTitle) + "</p>" +
        "<p class='latestChapterTime'>更新:" + formatTime("yyyy-MM-dd HH:mm", book.latestChapterTime) + "</p>" +
        "</div>" +
        "<div class='clearfix'></div>";
    
    return bookItem;
}

// 初始化书架
function getBookshelf() {
    freshTime();
    freshBookCache();
    var login = checkLoginState();
    
    if (login) {
        hide(".menu");
        hide("#topMenu");
        hide("#bottomMenu");
        menusVisible = false;

        HttpGet(url(bookshelf, { refresh: 0 }), function(res) {
            if (res && res.isSuccess) {
                var bookList = res.data;
                bookList = bookList.sort(function(a, b) {
                    return (b.durChapterTime || 0) - (a.durChapterTime || 0);
                });

                var bookListContainer = $("#bookList");
                var fragment = document.createDocumentFragment();
                
                // 批量创建书籍项
                for (var index = 0; index < bookList.length; index++) {
                    var bookItem = createBookItemElement(bookList[index], index);
                    fragment.appendChild(bookItem);
                }
                
                // 一次性更新DOM
                bookListContainer.innerHTML = '';
                bookListContainer.appendChild(fragment);
                
                // 立即浏览器全屏
                enterFullscreen();
                // 立即初始化懒加载
                initCoverLazyLoad(); 
                loadingOver();
            } else {
                loadingOver();
                alert(res ? res.errorMsg : "获取书架失败");
            }
        });
    }
}

// 处理书架点击事件
function handleBookshelfClick(bookItem) {
    // 直接从传入的 bookItem 元素获取数据，避免重复查找
    var bookUrlElement = bookItem.querySelector('.bookUrl');
    var sourceUrlElement = bookItem.querySelector('.sourceUrl');
    var authorElement = bookItem.querySelector('.author');
    var durChapterPosElement = bookItem.querySelector('.durChapterPos');
    
    if (bookUrlElement && authorElement && durChapterPosElement) {
        currentBookUrl = bookUrlElement.textContent;
        currentSourceUrl = sourceUrlElement.textContent;
        currentAuthor = authorElement.textContent.replace('作者:', '');
        currentChapterPos = durChapterPosElement.textContent;
         
        // 先获取章节列表，完成后才获取书籍内容 
        // refresh=false：先用服务端目录缓存，避免每次开书都重爬目录
        getChapterList(1, showChapterListNum, false, function() {
            var durChapterTitleElement = bookItem.querySelector('.durChapterTitle');
            var booknameElement = bookItem.querySelector('.bookname');
            
            if (durChapterTitleElement && booknameElement) {
                var durChapterTitle = durChapterTitleElement.textContent;
                currentBookName = booknameElement.textContent;
                setTitle(currentBookName, durChapterTitle.substr(5));
                
                var durChapterIndexElement = bookItem.querySelector('.durChapterIndex');
                if (durChapterIndexElement) {
                    getBookContentPage(
                        parseInt(durChapterIndexElement.textContent),
                        currentBookUrl
                    );
                }
            }
        });
    }
}

// Kindle 优化的懒加载初始化
function initCoverLazyLoad() {
    if (lazyLoadInitialized) return;
    lazyLoadInitialized = true;
    lazyScrollCount = 0; // 初始化时重置滚动计数
    preloadLog('初始化封面懒加载，滚动计数重置为0');
    
    // 立即检查一次
    checkVisibleCovers();
}
//书架专用
var lazyScrollTimeout;
var scrollHandler = function() {
    // 增加滚动计数
    lazyScrollCount++;
    if (lazyScrollTimeout) clearTimeout(lazyScrollTimeout);
    lazyScrollTimeout = setTimeout(function() {
        checkVisibleCovers();
    }, 100);
};

// 强制加载判断函数
function shouldForceLoadCovers() {
    var shouldForce = lazyScrollCount >= lazyScrollThreshold;
    if (shouldForce) {
        preloadLog('达到滚动阈值(' + lazyScrollThreshold + ')，触发强制加载');
        lazyScrollCount = 0; // 重置计数
    }
    return shouldForce;
}

// 视口检查
function isElementInViewportKindle(el) {
    if (!el || typeof el.getBoundingClientRect !== 'function') {
        return false;
    }
    
    try {
        var rect = el.getBoundingClientRect();
        var viewportHeight = (window.innerHeight || document.documentElement.clientHeight) - 220;
        var viewportWidth = window.innerWidth || document.documentElement.clientWidth;
        
        // 扩大检查范围，确保更多封面被加载
        return (
            rect.top >= -viewportHeight * 0.3 &&    // 向上扩展30%视口高度
            rect.left >= -viewportWidth * 0.3 &&     // 向左扩展30%视口宽度
            rect.bottom <= viewportHeight * 1.3 &&   // 向下扩展30%视口高度
            rect.right <= viewportWidth * 1.3        // 向右扩展30%视口宽度
        );
    } catch (e) {
        console.error('视口检查错误:', e);
        return true; // 出错时默认加载
    }
}

// 重写检查可见封面函数，优先视口检查，其次强制加载
function checkVisibleCovers() {
    var lazyCovers = document.querySelectorAll('.lazy-cover:not(.cover-loaded):not(.cover-error):not(.cover-loading)');
    var loadedCount = 0;
    
    if (lazyCovers.length)
        preloadLog('找到 ' + lazyCovers.length + ' 个待加载封面，滚动计数: ' + lazyScrollCount);
    // 第一阶段：优先视口检查加载
    for (var i = 0; i < lazyCovers.length && loadedCount < lazyCoversCount; i++) {
        var img = lazyCovers[i];
        var dataSrc = img.getAttribute('data-src');
        
        // 安全检查
        if (!dataSrc || !img.parentNode) {
            img.classList.add('cover-error');
            continue;
        }
        
        // 优先视口检查
        if (isElementInViewportKindle(img)) {
            loadCoverImage(img, 0);
            loadedCount++;
        }
    }
    
    // 第二阶段：如果视口检查加载数量不足且达到滚动阈值，进行强制加载
    var remainingSlots = lazyCoversCount - loadedCount;
    if (remainingSlots > 0  && lazyCovers.length && shouldForceLoadCovers()) {
        preloadLog('视口检查加载了 ' + loadedCount + ' 张，剩余 ' + remainingSlots + ' 个位置，进行强制加载');
        
        for (var j = 0; j < lazyCovers.length && loadedCount <lazyCoversCount; j++) {
            var forceImg = lazyCovers[j];
            var forceDataSrc = forceImg.getAttribute('data-src');
            
            // 安全检查
            if (!forceDataSrc || !forceImg.parentNode) {
                forceImg.classList.add('cover-error');
                continue;
            }
            
            // 跳过已经通过视口检查加载的图片
            if (forceImg.classList.contains('cover-loading') || 
                forceImg.classList.contains('cover-loaded')) {
                continue;
            }
            
            // 强制加载
            loadCoverImage(forceImg, 0);
            loadedCount++;
            
            // 如果达到最大加载数量，跳出循环
            if (loadedCount >= lazyCoversCount) {
                break;
            }
        }
    }
    
    if (loadedCount > 0) {
        preloadLog('本次总共加载了 ' + loadedCount + ' 张封面');
    }
}

// 图片加载函数
function loadCoverImage(img, retryCount) {
    if (!img || !img.parentNode) {
        preloadLog('图片元素无效，跳过加载');
        return;
    }
    
    var dataSrc = img.getAttribute('data-src');
    if (!dataSrc) {
        preloadLog('没有 data-src，标记为错误');
        img.classList.add('cover-error');
        return;
    }
    
    // 检查是否已经在加载中
    if (img.classList.contains('cover-loading')) {
        preloadLog('图片已在加载中，跳过:', dataSrc);
        return;
    }
    
    // 标记为加载中
    img.classList.add('cover-loading');
    
    preloadLog('开始加载封面: ' + dataSrc + (retryCount > 0 ? ' (重试 ' + retryCount + ')' : ''));
    var image = new Image();

    image.onerror = function() {
        img.classList.remove('cover-loading');
        
        if (retryCount < 1) {
            preloadLog('封面加载失败，准备重试: ' + dataSrc);
            setTimeout(function() {
                if (img.parentNode) {
                    loadCoverImage(img, retryCount + 1);
                }
            }, 500);
        } else {
            // 最终失败处理
            preloadLog('封面加载最终失败，使用默认图片: ' + dataSrc);
            img.src = "img/noCover.jpg";
            img.classList.remove('lazy-cover');
            img.classList.add('cover-error');
            img.removeAttribute('data-src');
        }
    };
    
    image.onload = function() {
        img.src = dataSrc;
        // WebKit534 的 DOMTokenList.remove 只处理第一个参数，拆成两次单参数调用
        img.classList.remove('lazy-cover');
        img.classList.remove('cover-loading');
        img.classList.add('cover-loaded');
        img.removeAttribute('data-src');
        lazyLoadedCovers[dataSrc] = true;
        preloadLog('封面加载成功: ' + dataSrc);
    };
    
    // 开始加载
    image.src = dataSrc;
}

function cleanupLazyLoad() {
    lazyLoadInitialized = false;
    lazyLoadedCovers = {};
    lazyScrollCount = 0; // 重置滚动计数
    if (window._lazyLoadScrollHandler) {
        window.removeEventListener('scroll', window._lazyLoadScrollHandler);
        window._lazyLoadScrollHandler = null;
    }
}

 // 显示章节列表
function showChapterList( ) {
    var pageNo = Math.floor(currentChapterIndex / showChapterListNum) + 1;
    getChapterList(pageNo, showChapterListNum);
    show(".bookChapterList");
    
    // 显示目录时开始多章节预加载
    startPreloadChapters(showChapterListNum, 1);
}

 // 获取章节列表
function getChapterList(pageNo, pageSize, refresh, callback) {
    var params = {
        refresh: refresh ? 1 : 0,
        url: currentBookUrl,
        // 直接带上书源地址，避免服务端再按书籍地址反查书源
        bookSourceUrl: currentSourceUrl
    };

    if (!pageNo || pageNo < 1) {
        pageNo = 1;
    }

    if (!pageSize) {
        pageSize = 10;
    }
    var startIndex = pageSize * (pageNo - 1); // 起始索引（包含）
    var endIndex = pageSize * pageNo; // 结束索引（不包含）
    
    if (refresh || !bookChapterMapCache) {
        if (config.type == "app") {
            HttpGet(url(chapterList, params), function(res) {
                handleChapterListResponse(res, pageNo, startIndex, endIndex, pageSize, callback);
            });
        } else {
            HttpPost(url(chapterList), params, function(res) {
                handleChapterListResponse(res, pageNo, startIndex, endIndex, pageSize, callback);
            });
        }
    } else {
        $("#chapterPageNo").textContent = pageNo;
        disposeChapterList(bookChapterMapCache, startIndex, endIndex, params.url, pageSize);

        if (callback) callback();
    }
}

 // 处理章节列表响应
function handleChapterListResponse(res, pageNo, startIndex, endIndex, pageSize, callback) {
    if (res && res.isSuccess) {
        $("#chapterPageNo").textContent = pageNo;
        bookChapterMapCache = res.data;
        disposeChapterList(bookChapterMapCache, startIndex, endIndex, currentBookUrl, pageSize);

        if (callback) callback();
    } else {
        errorLog(res ? res.errorMsg : "获取章节列表失败");
    }
    loadingOver();
}

// 创建按钮元素
function createChapterButton(chapterInfo, index) {
    var button = document.createElement('button');
    
    // 获取章节标题并格式化
    var title = getValue(chapterInfo.title);
    if (title.length > 18) {
        title = title.substring(0, 18) + "...";
    }
    
    // 设置按钮属性和内容
    button.className = "chapterName";
    button.value = chapterInfo.index;
    button.setAttribute('data-index', index);
    button.textContent = title;
    
    // 设置当前章节样式
    if (index == currentChapterIndex) {
        button.classList.add("modal-current");
    }
    
    // 设置预加载章节样式
    if (preloadedChaptersMapCache[index]) {
        button.classList.add("modal-preloaded");
    }
    
    return button;
}

// 处理章节列表显示
function disposeChapterList(data, startIndex, endIndex, bookUrl, pageSize) {
    if (!data || !data.length) return;
    
    // 更新标题和分页信息
    $("#chapterTitle").textContent = currentBookName;
    var pageTotal = Math.ceil(data.length / pageSize);
    $("#chapterPageTotal").textContent = pageTotal;
    
    // 创建文档片段
    var fragment1 = document.createDocumentFragment();
    var fragment2 = document.createDocumentFragment();
    var isColumnFlag = true;
    
    // 批量创建按钮
    for (var index = startIndex; index < endIndex && index < data.length; index++) {
        var chapterInfo = data[index];
        var button = createChapterButton(chapterInfo, index);
        
        if (isColumnFlag) {
            fragment1.appendChild(button);
        } else {
            fragment2.appendChild(button);
        }
        isColumnFlag = !isColumnFlag; //重置标志
    }
    
    // 一次性更新DOM
    chapterColumn1.innerHTML = '';
    chapterColumn2.innerHTML = '';
    chapterColumn1.appendChild(fragment1);
    chapterColumn2.appendChild(fragment2);
}

 // 处理章节点击事件
function handleChapterClick(target) {
    if (target.classList.contains('chapterName')) {
        var chapterIndex = parseInt(target.value);
        var chapterTitle = bookChapterMapCache[chapterIndex].title;
        setTitle(currentBookName, chapterTitle);
        
        // 检查是否有预加载内容可用
        var preloadedContent = getPreloadedContent(chapterIndex);
        if (preloadedContent) {
            handleBookContent(preloadedContent, chapterIndex, currentBookUrl, false, function() {
                hide(".bookChapterList");
                // 章节切换后启动预加载
                setTimeout(function() {
                    startPreloadChapters(1, 1);
                    setTimeout(clearMemory, 500);
                }, 100);
            });
            delete preloadedChaptersMapCache[chapterIndex];
        } else {
            getBookContentPage(chapterIndex, currentBookUrl);
            hide(".bookChapterList");
            // 章节切换后启动预加载
            setTimeout(function() {
                startPreloadChapters(1, 1);
                setTimeout(clearMemory, 500);
            }, 100);
        }
    }
}

//内存智能清理
function clearMemory() {
    var cacheSize = Object.keys(preloadedChaptersMapCache).length;
    
    // 触发清理的条件
    if (cacheSize > preloadCount * 2) {
        preloadLog("缓存数量(" + cacheSize + ")超过阈值，触发智能清理");
        smartClearPreloadCache();
    } else if (cacheSize > preloadCount * 3) {
        preloadLog("缓存数量(" + cacheSize + ")严重超过阈值，强制清理");
        // 紧急情况下的强制清理
        for (var index in preloadedChaptersMapCache) {
            var chapterIndex = parseInt(index);
            if (Math.abs(chapterIndex - currentChapterIndex) > preloadCount * 2) {
                delete preloadedChaptersMapCache[chapterIndex];
            }
        }
    }
}

// 跳转到指定章节页
function jumpChapterList(offset) {
    var chapterPageNo = $("#chapterPageNo");
    var pageNo = parseInt(chapterPageNo.textContent);

    if (offset) {
        pageNo = pageNo + parseInt(offset);
    } else {
        pageNo = $("#jumpChapterListTo").value;
    }
    chapterPageNo.textContent = pageNo;
    getChapterList(pageNo, showChapterListNum);
}

// 构造正文请求参数
// xread-fpk 的 BookContentRequest 中 url 被映射为 chapterUrl（章节地址），
// 因此必须显式传 chapterUrl + bookSourceUrl；章节地址未知时才回退到 bookUrl + index
function buildBookContentParams(chapterIndex, bookUrl) {
    var chapterInfo = bookChapterMapCache ? bookChapterMapCache[chapterIndex] : null;
    if (chapterInfo && chapterInfo.url) {
        return {
            chapterUrl: chapterInfo.url,
            bookSourceUrl: currentSourceUrl,
            refresh: 0
        };
    }
    return {
        url: bookUrl,
        bookSourceUrl: currentSourceUrl,
        index: chapterIndex,
        refresh: 0
    };
}

// 获取书籍内容
function getBookContent(targetChapterIndex, bookUrl, lastPage, callback) {
    var params = buildBookContentParams(targetChapterIndex, bookUrl);

    // 优先使用预加载内容
    var bookStr = getPreloadedContent(targetChapterIndex);
    if (bookStr) {
        // 使用预加载的内容
        handleBookContent(bookStr, targetChapterIndex, bookUrl, lastPage, callback);
        // 从预加载缓存中移除（避免重复存储）
        delete preloadedChaptersMapCache[targetChapterIndex];
    } else {
        // 预加载未命中，正常请求
        if (config.type == "app") {
            HttpGet(url(bookContent, params), function(res) {
                handleBookContentResponse(res, targetChapterIndex, bookUrl, lastPage, callback);
            });
        } else {
            HttpPost(url(bookContent), params, function(res) {
                handleBookContentResponse(res, targetChapterIndex, bookUrl, lastPage, callback);
            });
        }
    }
}

// 处理书籍内容响应
function handleBookContentResponse(res, targetChapterIndex, bookUrl, lastPage, callback) {
    if (res && res.isSuccess) {
        handleBookContent(res.data, targetChapterIndex, bookUrl, lastPage, callback);
    } else {
        errorLog(res ? res.errorMsg : "获取章节内容失败");
    }
}

// 处理书籍内容响应 
function handleBookContent(bookStr, targetChapterIndex, bookUrl, lastPage, callback) {
    if (!bookStr) {
        errorLog("章节内容为空");
        return;
    }

    disposeBookContent(targetChapterIndex, bookStr);
    getBookContentPage(currentChapterIndex, bookUrl, 1, lastPage);
    // 立即保存阅读进度（章节切换）
    saveReadProcess(targetChapterIndex, bookUrl, true);
    
    // 更新章节缓存
    if (targetChapterIndex == currentChapterIndex - 1) {
        nextChapterContent = currentChapterContent;
        preChapterContent = null;
    } else if (targetChapterIndex == currentChapterIndex + 1) {
        preChapterContent = currentChapterContent;
        nextChapterContent = null;
    }
    
    currentChapterContent = bookStr;
    currentChapterIndex = parseInt(targetChapterIndex);
    
    // === 基于翻页方向的智能预加载 ===
    preloadLog("章节切换，翻页方向:", lastPageTurnDirection);
    if (lastPageTurnDirection === 1) {
        // 向下翻页：主要预加载后续章节
        preloadLog("向下翻页，侧重预加载后续章节");
        startPreloadChapters(2, 1);  // 预加载后面1章
    } else if (lastPageTurnDirection === -1) {
        // 向上翻页：主要预加载前序章节
        preloadLog("向上翻页，侧重预加载前序章节");
        startPreloadChapters(2, -1); // 预加载前面1章
    } else {
        preloadLog("未知方向，暂不处理");
        //preloadLog("未知方向，平衡预加载两个方向");
        //startPreloadChapters(1, 1);  // 预加载后面1章
        //startPreloadChapters(1, -1); // 预加载前面1章
    }
    
    // 清除过期的预加载缓存
    smartClearPreloadCache();
    if (callback) callback();
}

// 检查章节是否应该预加载
function shouldPreloadChapter(chapterIndex) {
    // 检查索引有效性
    if (chapterIndex < 0) {
        return { shouldLoad: false, reason: "索引无效（小于0）" };
    }
    if (chapterIndex >= bookChapterMapCache.length) {
        return { shouldLoad: false, reason: "索引无效（超过最大章节数）" };
    }
    
    // 检查是否已缓存
    if (preloadedChaptersMapCache[chapterIndex]) {
        return { 
            shouldLoad: false, 
            reason: "已缓存" + (preloadedChaptersMapCache[chapterIndex] === 'loading' ? "（加载中）" : "")
        };
    }
    
    // 检查是否是当前章节
    if (chapterIndex === currentChapterIndex) {
        return { shouldLoad: false, reason: "当前章节" };
    }
    
    // 检查书籍URL和章节映射是否存在
    if (!currentBookUrl || !bookChapterMapCache) {
        return { shouldLoad: false, reason: "书籍数据未初始化" };
    }
    
    // 所有检查通过，可以预加载
    return { shouldLoad: true, reason: "" };
}

function startPreloadChapters(count, startOffset) {
    if (!enablePreload) return;
    if (!currentChapterIndex && currentChapterIndex !== 0) return;
    if (!currentBookUrl || !bookChapterMapCache) return;
    
    // 设置默认值
    if (startOffset === undefined || startOffset === null) {
        startOffset = 1;
    }
    
    // 清除之前的预加载定时器
    if (preloadTimer) {
        clearTimeout(preloadTimer);
    }
    
    // 延迟执行，避免影响当前操作
    preloadTimer = setTimeout(function() {
        // 确定实际要预加载的章节数量
        var actualPreloadCount = Math.min(count, preloadCount);
        
        // 收集需要预加载的章节索引
        var chaptersToPreload = [];
        for (var i = 0; i < actualPreloadCount; i++) {
            var chapterIndex = currentChapterIndex + startOffset + i;
            
            var checkResult = shouldPreloadChapter(chapterIndex);
            if (checkResult.shouldLoad) {
                chaptersToPreload.push(chapterIndex);
            } else {
                preloadLog("章节 " + chapterIndex + " 跳过预加载，原因: " + checkResult.reason);
            }
        }
        
        preloadLog("预加载方向:", startOffset > 0 ? "向后" : "向前", 
                   "数量:", chaptersToPreload.length, 
                   "章节:", chaptersToPreload);
        // 分批预加载
        if (chaptersToPreload.length > 0) {
        preloadChaptersBatch(chaptersToPreload, 0);
        }
    }, 100);
}

// 分批预加载章节（内部实现）
function preloadChaptersBatch(chapters, index) {
    if (index >= chapters.length) return;
    
    var chapterIndex = chapters[index];
    
    // 再次检查是否已预加载（防止重复）
    if (preloadedChaptersMapCache[chapterIndex]) {
        preloadLog("章节 " + chapterIndex + " 已在缓存中，跳过预加载");
        preloadChaptersBatch(chapters, index + 1);
        return;
    }
    // 标记为预加载中
    preloadedChaptersMapCache[chapterIndex] = 'loading';
    
    var params = buildBookContentParams(chapterIndex, currentBookUrl);
    
    // 延迟加载，避免同时发起太多请求
    setTimeout(function() {
        if (config.type == "app") {
            HttpGet(url(bookContent, params), function(res) {
                handlePreloadResponse(res, chapterIndex, currentBookUrl);
                preloadChaptersBatch(chapters, index + 1);
            });
        } else {
            HttpPost(url(bookContent), params, function(res) {
                handlePreloadResponse(res, chapterIndex, currentBookUrl);
                preloadChaptersBatch(chapters, index + 1);
            });
        }
    }, index * 100); // 每章间隔100ms
}

// 估算缓存内存使用量
function estimateCacheMemoryUsage(chapterIndex, cacheSize) {
    // 生产环境完全禁用
    if (!config.debugMode) return;
    // 只在调试级别足够时输出
    if (config.debugLevel < 2) return;

    var totalSize = 0;
    for (var index in preloadedChaptersMapCache) {
        var content = preloadedChaptersMapCache[index];
        if (typeof content === 'string') {
            // 估算字符串内存占用（UTF-16，2字节/字符）
            totalSize += content.length * 2;
        }
    }
    var cacheMemoryUsage = Math.round(totalSize / 1024); // 转换为KB
    preloadLog("预加载章节完成: " + chapterIndex + 
           ", 缓存大小: " + cacheSize + 
           ", 预估内存: " + cacheMemoryUsage + "KB");
}

// 处理预加载响应
 function handlePreloadResponse(res, chapterIndex, bookUrl) {
    if (res && res.isSuccess) {
        // 存储预加载的内容
        preloadedChaptersMapCache[chapterIndex] = res.data;
        var cacheSize = Object.keys(preloadedChaptersMapCache).length;
        // === 缓存状态监控 ===
        estimateCacheMemoryUsage(chapterIndex, cacheSize);

        // 监控缓存大小，超过限制时智能清理
        if (cacheSize > preloadCount * 2) {
            preloadLog("缓存超过限制，触发智能清理");
            smartClearPreloadCache();
        }
        
        // 如果是紧接着当前章节的下一章，更新nextChapterContent
        if (chapterIndex === currentChapterIndex + 1) {
            nextChapterContent = res.data;
        }
        
        // 更新目录显示（如果目录正在显示）
        updateChapterListStyle();
        // 预加载完成后检查内存
        clearMemory();
    } else {
        // 预加载失败，移除标记
        delete preloadedChaptersMapCache[chapterIndex];
        errorLog("预加载章节失败: " + chapterIndex);
    }
}

// 更新目录中章节的样式
function updateChapterListStyle() {
    var chapterButtons = document.querySelectorAll(".chapterName");
    
    for (var i = 0; i < chapterButtons.length; i++) {
        var button = chapterButtons[i];
        var chapterIndex = parseInt(button.value);
        
        // 移除之前的预加载样式
        button.classList.remove("modal-preloaded"); 
        
        // 如果已预加载，添加样式 - 使用新的通用类名
        if (preloadedChaptersMapCache[chapterIndex]) {
            button.classList.add("modal-preloaded");
        }
        
        // 更新当前章节样式
        button.classList.remove("modal-current");
        if (chapterIndex == currentChapterIndex) {
            button.classList.add("modal-current");
        }
    }
}

// 检查并利用预加载的内容（如果可用）
function getPreloadedContent(chapterIndex) {
    if (preloadedChaptersMapCache[chapterIndex] && 
        preloadedChaptersMapCache[chapterIndex] !== 'loading' &&
        preloadedChaptersMapCache[chapterIndex] !== null) {
        preloadLog("使用预加载的章节内容: " + chapterIndex);
        var content = preloadedChaptersMapCache[chapterIndex];
        return content;
    }
    return null;
}

// 基于阅读方向和章节距离进行智能清理
function smartClearPreloadCache() {
    if (!currentChapterIndex && currentChapterIndex !== 0) return;

    var cacheKeys = Object.keys(preloadedChaptersMapCache);
    if (cacheKeys.length === 0) return;
    var currentIndex = currentChapterIndex;
    var chaptersToKeep = {};
    var chaptersToDelete = [];
    cacheLog("开始智能缓存清理，当前章节:", currentIndex+1, "缓存数量:", cacheKeys.length);
    // 第一步：确定需要保留的章节范围
    var keepRange = calculateKeepRange(currentIndex);
    // 第二步：分类处理每个缓存章节
    for (var i = 0; i < cacheKeys.length; i++) {
        var chapterIndex = parseInt(cacheKeys[i]);
        var shouldKeep = shouldKeepChapter(chapterIndex, currentIndex, keepRange);
        if (shouldKeep) {
            chaptersToKeep[chapterIndex] = true;
        } else {
            chaptersToDelete.push(chapterIndex);
        }
    }
    // 第三步：执行删除操作
    if (chaptersToDelete.length > 0) {
        cacheLog("准备清理章节:", chaptersToDelete);
        for (var j = 0; j < chaptersToDelete.length; j++) {
            var deleteIndex = chaptersToDelete[j];
            delete preloadedChaptersMapCache[deleteIndex];
        }
        cacheLog("清理完成，剩余缓存:", Object.keys(preloadedChaptersMapCache).length);
    } else {
        cacheLog("无需清理，缓存均在合理范围内");
    }
    // 第四步：更新目录样式
    updateChapterListStyle();
}

//计算需要保留的章节范围（辅助函数）
function calculateKeepRange(currentIndex) {
    var range = {
        min: Math.max(0, currentIndex - preloadCount),
        max: Math.min((bookChapterMapCache ? bookChapterMapCache.length - 1 : 0), 
                     currentIndex + preloadCount)
    };
    // 根据阅读方向调整范围
    if (lastPageTurnDirection > 0) {
        // 向下阅读，优先保留后面的章节
        range.min = Math.max(0, currentIndex - Math.floor(preloadCount / 2));
        range.max = Math.min((bookChapterMapCache ? bookChapterMapCache.length - 1 : 0), 
                           currentIndex + preloadCount);
    } else if (lastPageTurnDirection < 0) {
        // 向上阅读，优先保留前面的章节
        range.min = Math.max(0, currentIndex - preloadCount);
        range.max = Math.min((bookChapterMapCache ? bookChapterMapCache.length - 1 : 0), 
                           currentIndex + Math.floor(preloadCount / 2));
    }
    return range;
}

 // 判断章节是否应该保留（辅助函数）
function shouldKeepChapter(chapterIndex, currentIndex, keepRange) {
    // 1. 在保留范围内的章节都保留
    if (chapterIndex >= keepRange.min && chapterIndex <= keepRange.max) {
        return true;
    }
    // 2. 当前章节的相邻章节（前后各1章）总是保留
    if (Math.abs(chapterIndex - currentIndex) <= 1) {
        return true;
    }
    // 3. 根据阅读方向保留相关章节
    if (lastPageTurnDirection > 0 && chapterIndex > currentIndex) {
        // 向下阅读时，保留后面的章节（即使稍微超出范围）
        return true;
    } else if (lastPageTurnDirection < 0 && chapterIndex < currentIndex) {
        // 向上阅读时，保留前面的章节（即使稍微超出范围）
        return true;
    }

    return false;
}

// 解析并处理书籍内容
function disposeBookContent(targetChapterIndex, bookStr) {
    hide(".c_bookshelf");
    show(".c_bookContent");
    var currentChapterName = bookChapterMapCache[targetChapterIndex].title;
    setTitle(currentBookName, currentChapterName);
    // 漫画检测：章节含多张图片时走「一张图一页」，绕开按字符硬切（否则只显示第一张图）
    var imgList = bookStr.match(/<img\b[^>]*>/gi);
    if (imgList && imgList.length > 1) {
        isComicMode = true;
        pageList = imgList;
    } else {
        isComicMode = false;
        // r92 修复标题与正文之间的多余空行：
        // 章节标题来自目录，正文由后端返回。二者各自可能带前导/尾随换行或空白，
        // 直接拼接会在标题和正文之间产生多个连续换行，Kindle 上渲染成约两行空白。
        // 这里先各自去掉首尾空白，再只用一个换行连接，保证标题紧贴正文。
        var cleanTitle = String(currentChapterName).replace(/^[\s\u3000\u00A0]+|[\s\u3000\u00A0]+$/g, "");
        // 只去掉首尾的换行符，保留 formatChapterContent 给首行加的全角缩进
        var cleanBody = formatChapterContent(bookStr).replace(/^\n+|\n+$/g, "");
        bookStr = cleanTitle + "\n" + cleanBody;
        pageList = calculateCharsPerPage(bookStr);
    }
    currentBookPage = 1;
    currentBookTotalPage = pageList.length;
}

// 显示当前页内容
function showContent(pages) {
    if (currentBookPage > currentBookTotalPage) {
        currentBookPage = currentBookTotalPage;
    }
    if (isComicMode) {
        // 漫画：一页一张图，图片按内容区尺寸自适应（老 WebKit 用 style 直接设，稳）
        var imgHtml = pages[currentBookPage - 1] || "";
        contentElement.innerHTML = '<div class="comic-page">' + imgHtml + '</div>';
        var theImg = contentElement.querySelector('img');
        if (theImg) {
            var cw = contentElement.clientWidth || 600;
            var ch = contentElement.clientHeight || 800;
            theImg.style.maxWidth = cw + 'px';
            theImg.style.maxHeight = ch + 'px';
        }
    } else {
        var pageHtml = pages[currentBookPage - 1].replace(/\n/g, '<br>');
        // 兜底：压缩连续换行，避免正文出现大面积空白行
        // 空白字符含全角空格(U+3000)/不间断空格(\u00A0)，老 WebKit 下 \s 不一定覆盖，显式列出
        // r92：标题后若仍有连续 <br>（含全角空格填充的空行），一律压成单个
        pageHtml = pageHtml.replace(/(<br[\s\u3000\u00A0]*\/?>[\s\u3000\u00A0]*){2,}/gi, '<br>');
        // 去掉正文开头紧贴的 <br>（标题换行后不再留空行）
        pageHtml = pageHtml.replace(/^(<br[\s\u3000\u00A0]*\/?>)+/i, '');
        contentElement.innerHTML = pageHtml;
    }
    setContentPageInfo();
}

// 优化后的保存阅读进度函数
function saveReadProcess(targetChapterIndex, bookUrl, forceSave) {
    // 参数验证
    if (targetChapterIndex === null || targetChapterIndex === undefined) {
        return;
    }
    
    if (!bookUrl) {
        errorLog("保存进度失败：书籍URL为空");
        return;
    }
    
    // 只有在章节改变或强制保存时才保存进度
    var shouldSave = forceSave || (targetChapterIndex !== currentChapterIndex);
    
    if (!shouldSave) {
        preloadLog("章节未改变，跳过保存进度");
        return;
    }
    
    var params = {
        index: targetChapterIndex,
        refresh: 1,
        url: bookUrl
    };

    // 添加书籍基本信息用于更好的进度追踪
    if (currentBookName) {
        params.name = currentBookName;
    }
    if (currentAuthor) {
        params.author = currentAuthor;
    }
    
    // 记录保存时间
    var saveTime = Date.now();
    preloadLog("开始保存阅读进度，章节:" + targetChapterIndex + ", 时间:" + formatTime("HH:mm:ss", saveTime));
    if (config.type == "app") {
        params = {
            name: currentBookName,
            author: currentAuthor,
            durChapterIndex: targetChapterIndex,
            durChapterTime: saveTime,
            durChapterTitle: bookChapterMapCache && bookChapterMapCache[targetChapterIndex] ? 
                            bookChapterMapCache[targetChapterIndex].title : "未知章节"
        };

        HttpPost(url(saveBookProgress), params, function(res) {
            handleSaveProgressResponse(res, targetChapterIndex, saveTime);
        });
    } else {
        HttpPost(url(saveBookProgress), params, function(res) {
            handleSaveProgressResponse(res, targetChapterIndex, saveTime);
        });
    }
}

// 处理保存进度响应
function handleSaveProgressResponse(res, targetChapterIndex, saveTime) {
    if (res && res.isSuccess) {
        var elapsed = Date.now() - saveTime;
        preloadLog("进度保存成功，章节:" + targetChapterIndex + 
                  ", 耗时:" + elapsed + "ms");
        
        // 更新本地记录的当前章节索引
        // r96 修复：归一化为数字，避免字符串索引污染导致翻章时 +1 变字符串拼接（序章翻页失效）
        var normalizedIndex = parseInt(targetChapterIndex, 10);
        currentChapterIndex = isNaN(normalizedIndex) ? 0 : normalizedIndex;
    } else {
        errorLog("进度保存失败: " + (res ? res.errorMsg : "未知错误"));
    }
    loadingOver();
}

// 同步保存进度（用于页面卸载等关键场景）
function saveReadProcessSync(targetChapterIndex, bookUrl) {
    // r96 修复：原 !targetChapterIndex 会把序章(index=0)误判为无效而跳过保存
    if (targetChapterIndex === null || targetChapterIndex === undefined || 
        targetChapterIndex === '' || !bookUrl) return;
    
    var xhr = new XMLHttpRequest();
    var params = {
        index: targetChapterIndex,
        refresh: 1,
        url: bookUrl
    };
    
    if (currentBookName) params.name = currentBookName;
    if (currentAuthor) params.author = currentAuthor;
    
    var urlStr = url(saveBookProgress);
    
    xhr.open('POST', urlStr, false); // 同步请求
    xhr.setRequestHeader('Content-Type', 'application/json;charset=utf-8');
    
    if (config.type == "multi") {
        xhr.withCredentials = true;
    }
    
    try {
        xhr.send(JSON.stringify(params));
        preloadLog("同步保存进度完成，章节:" + targetChapterIndex);
    } catch (e) {
        errorLog("同步保存进度失败: " + e.message);
    }
}

// r72 性能优化：把测量器样式同步与「读高度」分离。
// 原实现每次测量都 getComputedStyle + 写10个样式 + innerHTML + 读 offsetHeight，
// 在分页二分循环里被调用几十~上百次，每次都是一次强制同步重排（reflow）。
// 拆出 syncMeasurerStyle()，在每批分页开始前只做一次；测量时只改内容+读高度。
// 注意：fontWeight 由 updateElementFontStyle 直接写入测量器内联样式，此处不覆盖，
// 与原实现一致（原实现也未设置 fontWeight），保证测量结果完全相同。
function syncMeasurerStyle() {
    if (!textMeasurer) return;
    var computedStyle = window.getComputedStyle(contentElement);
    textMeasurer.style.fontFamily = computedStyle.fontFamily;
    textMeasurer.style.fontSize = computedStyle.fontSize;
    textMeasurer.style.letterSpacing = computedStyle.letterSpacing;
    textMeasurer.style.lineHeight = computedStyle.lineHeight;
    textMeasurer.style.width = computedStyle.width;
    textMeasurer.style.paddingLeft = computedStyle.paddingLeft;
    textMeasurer.style.paddingRight = computedStyle.paddingRight;
    textMeasurer.style.paddingTop = computedStyle.paddingTop;
    textMeasurer.style.paddingBottom = computedStyle.paddingBottom;
    textMeasurer.style.margin = "0";
    textMeasurer.style.border = "none";
    textMeasurer.style.boxSizing = "border-box";
}

// 使用隐藏的div测量文本高度（仅改内容 + 读高度，避免重复重排）
function textMeasurerHigh(text) {
    if (!textMeasurer) return 0;
    textMeasurer.innerHTML = text.replace(/\n/g, '<br>');
    return textMeasurer.offsetHeight;
}

// 计算每页显示的字符内容
function calculateCharsPerPage(bookStr) {
    // r72：样式同步只做一次（原为每次测量都做），大幅减少强制重排
    syncMeasurerStyle();
    var containerHeight = contentElement.clientHeight;
    var pages = [];
    var currentPage = "";
    var tempPage = "";
    
    // 处理HTML标签
    bookStr = bookStr.replace(/<p>/g, "")
                    .replace(/<br>|<br\/>|<\/p>/g, "\n");
    
    var perAddNum = 200;
    var addNum = perAddNum;
    var i = 0;
    var dFlag = false;
    
    while (i < bookStr.length) {
        tempPage += bookStr.substring(i, i + addNum);
        i += addNum;
        
        if (textMeasurerHigh(tempPage) > containerHeight) {
            if (addNum === 1) {
                if (currentPage.trim() != "") {
                    pages.push(currentPage);
                }
                i -= 1;
                tempPage = "";
                currentPage = "";
                addNum = perAddNum;
                dFlag = false;
            } else {
                i -= addNum;
                tempPage = currentPage;
                if (addNum >= 2) {
                    addNum = Math.floor(addNum / 2);
                    dFlag = true;
                } else {
                    addNum = 1;
                }
            }
        } else {
            currentPage = tempPage;
            if (dFlag === true) {
                if (addNum >= 2) {
                    addNum = Math.floor(addNum / 2);
                } else {
                    addNum = 1;
                }
                dFlag = false;
            }
        }
    }

    if (currentPage.trim() != "") {
        pages.push(currentPage);
    }

    return pages;
}

// 获取书籍内容页面
 function getBookContentPage(targetChapterIndex, bookUrl, pageNo, lastPage) {
    freshTime();
    // r96 修复（根因）：章节索引统一归一化为数字。
    // 进度保存回调曾把 currentChapterIndex 赋成字符串（如 "0"），导致：
    //   1) 严格比较 targetChapterIndex !== currentChapterIndex 时 0 !== "0" 成立，
    //      误判为切换章节而重新加载本章（序章点下一页无反应）；
    //   2) currentChapterIndex + 1 变成 "01" 字符串拼接，翻到错误章节。
    // 在入口处把目标索引和全局索引都规范化，后续所有比较/运算即安全。
    targetChapterIndex = parseInt(targetChapterIndex, 10);
    if (isNaN(targetChapterIndex)) targetChapterIndex = 0;
    var normalizedCur = parseInt(currentChapterIndex, 10);
    if (!isNaN(normalizedCur)) currentChapterIndex = normalizedCur;
    // 优先检查预加载缓存
    var preloadedContent = getPreloadedContent(targetChapterIndex);
    if (preloadedContent && targetChapterIndex !== currentChapterIndex) {
        // 使用预加载的内容
        handleBookContent(preloadedContent, targetChapterIndex, bookUrl, lastPage, function() {
            if (lastPage) {
                currentBookPage = currentBookTotalPage;
            } else if (pageNo > 0 && pageNo <= currentBookTotalPage) {
                currentBookPage = pageNo;
            } else {
                currentBookPage = 1;
            }
            showContent(pageList);
            show(".menu");
            loadingOver();
            // 确保进度保存
            saveReadProcess(targetChapterIndex, bookUrl, true);
            setTimeout(function() {
                    clearMemory();
                    //debugCacheStatus();
                }, 500);
        });
        // 从预加载缓存中移除
        delete preloadedChaptersMapCache[targetChapterIndex];
        return;
    }
    if (lastPage) pageNo = currentBookTotalPage;
    if (pageNo == null) pageNo = 1;
    
    if (targetChapterIndex !== currentChapterIndex) {
        getBookContent(targetChapterIndex, bookUrl, lastPage, function() {
            if (lastPage) {
                currentBookPage = currentBookTotalPage;
            } else if (pageNo > 0 && pageNo <= currentBookTotalPage) {
                currentBookPage = pageNo;
            } else {
                currentBookPage = 1;
            }
            showContent(pageList);
            show(".menu");
            loadingOver();
            
            setTimeout(function() {
                    clearMemory();
                    //debugCacheStatus();
                }, 500);
        });
        return;
    }

    // 处理当前章节内的翻页
    // r96 修复：章节索引先归一化为数字。历史上 currentChapterIndex 在进度保存回调
    // （handleSaveProgressResponse）里可能被赋成字符串（如 "0"），此时下面的
    // currentChapterIndex + 1 会变成字符串拼接 "01" 而非数字 1，导致跨章翻页时
    // 用错误的章节地址重新加载本章（表现为序章(index=0)点下一页无反应）。
    // 统一 parseInt 后，"0" -> 0，0+1 -> 1，翻章恢复正常。
    var curIdx = parseInt(currentChapterIndex, 10);
    if (isNaN(curIdx)) curIdx = 0;
    if (pageNo <= 0) {
        if (curIdx <= 0 && currentBookPage <= 1) {
            loadingOver();
            return;
        }
        if (currentBookPage <= 1) {
            getBookContentPage(curIdx - 1, bookUrl, 0, true);
            return;
        }
        pageNo = currentBookPage - 1;
    } else if (pageNo > currentBookTotalPage) {
        if (curIdx >= bookChapterMapCache.length - 1 && 
            currentBookPage >= currentBookTotalPage) {
            loadingOver();
            return;
        }
        if (currentBookPage >= currentBookTotalPage) {
            getBookContentPage(curIdx + 1, bookUrl, 1, false);
            return;
        }
        pageNo = currentBookPage + 1;
    }

    currentBookPage = pageNo;
    showContent(pageList);
    show(".menu");
    loadingOver();
    
    // 根据翻页方向和阅读位置进行智能预加载
    if (bookChapterMapCache && currentBookUrl) {
        var pageRatio = currentBookPage / currentBookTotalPage;
        
        if (lastPageTurnDirection === -1 && pageRatio < 1/4 && currentChapterIndex > 0) {
            preloadLog("接近章节开头，预加载前序章节");
            startPreloadChapters(1, -1); // 预加载前面1章
        } else if (lastPageTurnDirection === 1 && pageRatio > 3/4 && currentChapterIndex < bookChapterMapCache.length - 1) {
            preloadLog("接近章节末尾，预加载后续章节");
            startPreloadChapters(1, 1); // 预加载后面1章
        }
        
        // 重置翻页方向（避免影响下次判断）
        lastPageTurnDirection = 0;
    }
}

function prePage() {
    loading();
    lastPageTurnDirection = -1; // 记录为向上翻页
    jumpToBookContentPage(-1);
}

function nextPage() {
    loading();
    lastPageTurnDirection = 1; // 记录为向下翻页
    jumpToBookContentPage(1);
}

function jumpToBookContentPage(offset) {
    loading();
    // 记录翻页方向
    lastPageTurnDirection = offset > 0 ? 1 : -1;
    
    // 直接计算目标页码，让getBookContentPage处理边界情况
    var targetPage = currentBookPage + offset;
    getBookContentPage(
        parseInt(currentChapterIndex),
        currentBookUrl,
        targetPage
    );
}

function jumpSourcePage(offset) {
    var targetPage = currentSourcePage + offset;
    if (targetPage < 1) {
        return;
    }

    // 已翻到本地缓存末尾，若服务端还有更多书源则继续拉取
    if (targetPage > totalSourcePages) {
        if (!hasMoreSource || sourceFetching) {
            return;
        }
        loadingP = $("#sourcing");
        loading();
        getSourceList(targetPage, sourcePageSize, false);
        return;
    }
    
    loadingP = $("#sourcing");
    loading();
    
    // 使用缓存数据直接翻页
    disposeSourceList(bookSourceMapCache, targetPage, sourcePageSize);
    updateSourcePageInfo();
    
    loadingOver();
}

// 显示书籍管理弹窗（书源切换已停用）
// 当前后端无可用换源候选，书源列表恒为空且一直转圈；改为只显示书名 +「移动书籍」+「移除书籍」。
// 不调用 getSourceList()，也就不会再发书源请求、不再出现加载中的转圈图标。
function showBookManage() {
    // 未登录时不显示书籍管理（与书架管理一致），防止弹窗穿透登录界面
    if (!accessToken) {
        hide(".bookSourceList");
        return;
    }
    // 标题沿用弹窗原有的 #sourceTitle，直接显示当前书名
    var titleEl = document.getElementById("sourceTitle");
    if (titleEl) {
        titleEl.innerHTML = currentBookName || "书籍管理";
    }
    // 每次打开都收起移动/删除面板，清空提示，避免残留上一次操作
    var panel = document.getElementById("bookGroupPanel");
    if (panel) panel.style.display = "none";
    var dpanel = document.getElementById("bookDeletePanel");
    if (dpanel) dpanel.style.display = "none";
    var chk = document.getElementById("confirmDeleteCheck");
    if (chk) chk.checked = false;
    var hint = document.getElementById("bookGroupHint");
    if (hint) hint.innerHTML = "";
    var mhint = document.getElementById("bookManageHint");
    if (mhint) mhint.innerHTML = "";
    show(".bookSourceList");
}

// ===== 移动书籍到已有分组 =====
// 后端接口：GET  getBookGroups   -> [{groupId, groupName, orderNo}]
//           POST saveBookGroupId {bookUrl, groupId} -> 把书籍 group 设为指定分组（0 = 未分组）
var bookGroupsCache = [];

function loadBookGroups() {
    var sel = document.getElementById("bookGroupSelect");
    var hint = document.getElementById("bookGroupHint");
    if (!sel) {
        return;
    }
    sel.options.length = 0;
    sel.options.add(new Option("未分组", "0"));
    bookGroupsCache = [];
    if (hint) {
        hint.innerHTML = "正在读取分组…";
    }

    var xhr = new XMLHttpRequest();
    xhr.open("GET", url(getBookGroups), true);
    if (config.type == "multi") {
        xhr.withCredentials = true;
    }
    xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) {
            return;
        }
        if (xhr.status === 200) {
            var res = null;
            try {
                res = JSON.parse(xhr.responseText);
            } catch (e) {
                res = null;
            }
            var groups = (res && res.data && res.data.length) ? res.data : [];
            for (var i = 0; i < groups.length; i++) {
                var g = groups[i];
                var gid = parseInt(g.groupId, 10);
                if (isNaN(gid)) {
                    gid = 0;
                }
                sel.options.add(new Option(g.groupName || ("分组" + gid), String(gid)));
            }
            bookGroupsCache = groups;
            if (hint) {
                hint.innerHTML = groups.length
                    ? "选择分组后立即生效"
                    : "暂无分组，可先在网页端新建分组";
            }
        } else {
            if (hint) {
                hint.innerHTML = "分组读取失败，请稍后重试";
            }
        }
    };
    xhr.send();
}

function showMoveBookPanel() {
    var panel = document.getElementById("bookGroupPanel");
    if (!panel) {
        return;
    }
    var dpanel = document.getElementById("bookDeletePanel");
    if (panel.style.display === "block") {
        // 再次点击收起
        panel.style.display = "none";
        return;
    }
    panel.style.display = "block";
    if (dpanel) dpanel.style.display = "none";
    loadBookGroups();
}

// 移除书籍：展开确认面板，填入书名/作者（再次点击收起）
function showDeletePanel() {
    var panel = document.getElementById("bookDeletePanel");
    if (!panel) {
        return;
    }
    var gpanel = document.getElementById("bookGroupPanel");
    if (panel.style.display === "block") {
        panel.style.display = "none";
        return;
    }
    var nameEl = document.getElementById("deleteBookName");
    var authorEl = document.getElementById("deleteBookAuthor");
    if (nameEl) nameEl.innerHTML = currentBookName || "-";
    if (authorEl) authorEl.innerHTML = currentAuthor || "-";
    var chk = document.getElementById("confirmDeleteCheck");
    if (chk) chk.checked = false;
    panel.style.display = "block";
    if (gpanel) gpanel.style.display = "none";
}

// 勾选确认后执行删除
function onConfirmDeleteChange() {
    var chk = document.getElementById("confirmDeleteCheck");
    if (chk && chk.checked) {
        doDeleteBook();
    }
}

// ===== 设置页「配置书籍」功能区：2×2 卡片 + 底部状态栏 =====
// 后端无缓存大小(MB)接口，B 卡用缓存章节数占位；A 卡显示总章数 + 成功/失败(服务器缓存)。
// 移出书架 = 二次确认（首次点击变「确认移出?」+ 状态栏提示，再次点击才真正删除），
// 对应附件「再次点击「确认删除」以移除本书」的最后一行详细进度。
var bookMgmtNeedShelfRefresh = false;
var bookMgmtRemoveArmed = false;       // 移出书架是否已进入确认态
var bookMgmtRemoveArmedUrl = "";       // 确认态针对哪一本书（换书自动解除）

// 底部状态栏统一写入口
function bmSetStatus(text) {
    var el = document.getElementById("bmStatus");
    if (el) { el.innerHTML = text; }
}
// 设状态栏文字并高亮（成功/失败样式与附件一致：纯黑文字）
function bmStatus(text) {
    bmSetStatus(text);
}

// 打开设置页时：填充书名/作者、总章数、缓存章数，复位确认态
function initBookMgmt() {
    var title = document.getElementById("bmBookTitle");
    var author = document.getElementById("bmBookAuthor");
    if (title) { title.innerHTML = currentBookName ? ("书名：" + currentBookName) : "（未打开书籍）"; }
    if (author) { author.innerHTML = currentAuthor ? ("作者：" + currentAuthor) : "—"; }
    // A 卡总章数（章节列表已加载则取长度）
    var cnt = document.getElementById("bmCacheCount");
    var total = bookChapterMapCache ? bookChapterMapCache.length : 0;
    if (cnt) { cnt.innerHTML = total > 0 ? String(total) : "0"; }
    // B 卡占用缓存章节数（无接口，沿用 A 卡可读值占位）
    var sz = document.getElementById("bmClearSize");
    if (sz) { sz.innerHTML = total > 0 ? String(total) : "0"; }
    // 解除上一本书遗留的移出确认态
    bookMgmtRemoveArmed = false;
    bookMgmtRemoveArmedUrl = "";
    var delBtn = document.querySelector('[data-bookmgmt="delete"]');
    if (delBtn) { delBtn.innerHTML = "移出书架"; delBtn.className = "bm-card-btn bm-btn-dark"; }
    bmSetStatus("各卡片操作结果");
    // 打开设置页即预加载分组下拉框（不依赖点击按钮）
    mgmtLoadGroups();
}

// 卡片按钮分派
function setBookMgmtTab(tab) {
    if (tab === "cache") { mgmtCacheBook(); }
    else if (tab === "clear") { mgmtClearCache(); }
    else if (tab === "move") { mgmtMoveToGroup(); }
    else if (tab === "delete") { mgmtRemoveBook(); }
}

// 缓存书籍：SSE 进度流（老 Kindle 无 EventSource，用 XHR 逐段读）
function mgmtCacheBook() {
    if (!currentBookUrl) { bmStatus("请先打开一本书再操作"); return; }
    bmStatus("正在提交服务器缓存任务…");
    var cnt = document.getElementById("bmCacheCount");
    var det = document.getElementById("bmCacheDetail");
    var xhr = new XMLHttpRequest();
    xhr.open("GET", url(cacheBookSSE, { url: currentBookUrl, count: 0, refresh: 0 }), true);
    if (config.type == "multi") { xhr.withCredentials = true; }
    function parseProgress(dst) {
        var txt = xhr.responseText || "";
        var lines = txt.split("\n");
        var last = "";
        for (var i = lines.length - 1; i >= 0; i--) {
            if (lines[i].indexOf("data:") === 0) { last = lines[i].substring(5); break; }
        }
        if (!last) { return null; }
        try { return JSON.parse(last); } catch (e) { return null; }
    }
    function render(o, done) {
        if (!o) { return; }
        if (cnt) { cnt.innerHTML = (o.cachedCount != null ? String(o.cachedCount) : "0"); }
        if (det) { det.innerHTML = "成功 " + (o.successCount || 0) + " · 失败 " + (o.failedCount || 0) + " · 缓存"; }
        bmStatus("已缓存 " + (o.cachedCount || 0) + " 章（成功 " + (o.successCount || 0) + "，失败 " + (o.failedCount || 0) + "）" + (done ? " · 完成" : ""));
    }
    xhr.onreadystatechange = function () {
        if (xhr.readyState === 3) { render(parseProgress(), false); }
        else if (xhr.readyState === 4) {
            if (xhr.status === 200) {
                var o = parseProgress();
                if (o) { render(o, true); }
                else { bmStatus("服务器缓存完成"); }
                // 缓存完成后同步 B 卡占用章节数
                var sz = document.getElementById("bmClearSize");
                var cnt2 = document.getElementById("bmCacheCount");
                if (sz && cnt2) { sz.innerHTML = cnt2.innerHTML; }
            } else {
                bmStatus("缓存失败，请检查网络或书源");
            }
        }
    };
    xhr.onerror = function () { bmStatus("缓存失败，请检查网络"); };
    xhr.send();
}

// 清除缓存：删除服务端整书缓存
function mgmtClearCache() {
    if (!currentBookUrl) { bmStatus("请先打开一本书再操作"); return; }
    bmStatus("正在清除服务器缓存…");
    HttpPost(url(deleteBookCache), { bookUrl: currentBookUrl }, function (res) {
        if (res && res.isSuccess) {
            bmStatus("已清除当前书籍缓存");
            var sz = document.getElementById("bmClearSize");
            if (sz) { sz.innerHTML = "0"; }
            var cnt = document.getElementById("bmCacheCount");
            if (cnt) { cnt.innerHTML = "0"; }
            var det = document.getElementById("bmCacheDetail");
            if (det) { det.innerHTML = "成功 0 · 失败 0 · 缓存"; }
        } else {
            bmStatus("清除失败" + (res && res.errorMsg ? "：" + res.errorMsg : ""));
        }
    });
}

// 移动书籍：读取已有分组填入下拉框
function mgmtLoadGroups() {
    var sel = document.getElementById("mgmtGroupSelect");
    if (!sel) { return; }
    sel.options.length = 0;
    sel.options.add(new Option("未分组", "0"));
    bmStatus("正在读取分组…");
    var xhr = new XMLHttpRequest();
    xhr.open("GET", url(getBookGroups), true);
    if (config.type == "multi") { xhr.withCredentials = true; }
    xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) { return; }
        if (xhr.status === 200) {
            var res = null;
            try { res = JSON.parse(xhr.responseText); } catch (e) { res = null; }
            var groups = (res && res.data && res.data.length) ? res.data : [];
            for (var i = 0; i < groups.length; i++) {
                var gid = parseInt(groups[i].groupId, 10);
                if (isNaN(gid)) { gid = 0; }
                sel.options.add(new Option(groups[i].groupName || ("分组" + gid), String(gid)));
            }
            bmStatus(groups.length ? "选择分组后点「移动分组」" : "暂无分组");
        } else {
            bmStatus("分组读取失败");
        }
    };
    xhr.send();
}

// 点击「移动分组」按钮后执行（选择下拉框本身不触发）
function mgmtMoveToGroup() {
    var sel = document.getElementById("mgmtGroupSelect");
    if (!sel || !currentBookUrl) { return; }
    var gid = parseInt(sel.value, 10);
    if (isNaN(gid)) { gid = 0; }
    var groupName = sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text : "";
    HttpPost(url(saveBookGroupId), { bookUrl: currentBookUrl, groupId: gid }, function (res) {
        bmStatus((res && res.isSuccess) ? ("已移动到「" + groupName + "」") : "移动失败");
    });
}

// 移出书架：二次确认。首次点击进入确认态（按钮变蓝 + 状态栏提示），再次点击执行删除。
function mgmtRemoveBook() {
    var btn = document.querySelector('[data-bookmgmt="delete"]');
    if (!currentBookUrl) { bmStatus("请先打开一本书再操作"); return; }
    // 换书自动解除确认态
    if (bookMgmtRemoveArmedUrl && bookMgmtRemoveArmedUrl !== currentBookUrl) {
        bookMgmtRemoveArmed = false;
        bookMgmtRemoveArmedUrl = "";
    }
    if (!bookMgmtRemoveArmed) {
        bookMgmtRemoveArmed = true;
        bookMgmtRemoveArmedUrl = currentBookUrl;
        if (btn) { btn.innerHTML = "确认移出?"; btn.className = "bm-card-btn bm-btn-confirm"; }
        bmStatus("再次点击「确认移出」以移出本书");
        return;
    }
    // 第二次点击：真正执行移出
    bookMgmtRemoveArmed = false;
    bookMgmtRemoveArmedUrl = "";
    if (btn) { btn.innerHTML = "移出书架"; btn.className = "bm-card-btn bm-btn-dark"; }
    bmStatus("正在移出「" + (currentBookName || "当前书籍") + "」…");
    var params = {
        refresh: 1,
        url: currentBookUrl,
        bookUrl: currentBookUrl,
        origin: currentSourceUrl,
        name: currentBookName,
        author: currentAuthor
    };
    HttpPost(url(deleteBook), params, function (res) {
        if (res && res.isSuccess) {
            bookMgmtNeedShelfRefresh = true;
            bmStatus("已移出「" + (currentBookName || "当前书籍") + "」");
        } else {
            bmStatus("移出失败" + (res && res.errorMsg ? "：" + res.errorMsg : ""));
        }
    });
}

// 缓存书籍到服务器（SSE 进度流；老 Kindle 无 EventSource，用 XHR 读流）
function cacheCurrentBook() {
    if (!currentBookUrl) {
        var h0 = document.getElementById("bookManageHint");
        if (h0) h0.innerHTML = "请先打开一本书";
        return;
    }
    var hint = document.getElementById("bookManageHint");
    if (hint) hint.innerHTML = "正在提交缓存任务…";
    var xhr = new XMLHttpRequest();
    xhr.open("GET", url(cacheBookSSE, { url: currentBookUrl, count: 0, refresh: 0 }), true);
    if (config.type == "multi") {
        xhr.withCredentials = true;
    }
    function parseProgress() {
        var txt = xhr.responseText || "";
        var lines = txt.split("\n");
        var last = "";
        for (var i = lines.length - 1; i >= 0; i--) {
            if (lines[i].indexOf("data:") === 0) {
                last = lines[i].substring(5);
                break;
            }
        }
        if (!last || !hint) return;
        try {
            var o = JSON.parse(last);
            hint.innerHTML = "已缓存 " + o.cachedCount + " 章（成功 " + o.successCount + "，失败 " + o.failedCount + "）";
        } catch (e) {}
    }
    xhr.onreadystatechange = function () {
        if (xhr.readyState === 3) {
            parseProgress();
        } else if (xhr.readyState === 4) {
            if (xhr.status === 200) {
                parseProgress();
                if (hint) hint.innerHTML += " · 完成";
            } else {
                if (hint) hint.innerHTML = "缓存失败，请检查网络或书源";
            }
        }
    };
    xhr.onerror = function () {
        if (hint) hint.innerHTML = "缓存失败，请检查网络";
    };
    xhr.send();
}

// 选择分组后即时生效：不需要确认按钮，也不弹「已移动到X组」提示。
function moveBookToGroup() {
    var sel = document.getElementById("bookGroupSelect");
    if (!sel || !currentBookUrl) {
        return;
    }
    var gid = parseInt(sel.value, 10);
    if (isNaN(gid)) {
        gid = 0;
    }
    var params = {
        bookUrl: currentBookUrl,
        groupId: gid
    };
    HttpPost(url(saveBookGroupId), params, function (res) {
        if (res && res.isSuccess) {
            // 静默生效：收起移动面板，不弹 alert、不显示成功文字
            var panel = document.getElementById("bookGroupPanel");
            if (panel) {
                panel.style.display = "none";
            }
        }
        // 失败时保持静默，避免打断阅读
    });
}

// 处理书源列表显示，书源路径不等同于书籍路径
function createSourceButton(sourceInfo, index) {
    var button = document.createElement('button');
    
    button.className = "sourceName";
    button.value = sourceInfo.bookUrl;
    button.setAttribute('data-index', index);
    
    // 显示文本（xread 的搜索结果只返回 origin 地址，没有 originName）
    var displayText = "书源" + (index + 1);
    var originName = sourceInfo.originName || "";
    if (!originName && sourceInfo.origin) {
        var hostMatch = sourceInfo.origin.match(/^https?:\/\/([^\/]+)/i);
        originName = hostMatch ? hostMatch[1] : sourceInfo.origin;
    }
    if (originName) {
        if (originName.length > 12) {
            originName = originName.substring(0, 12) + "...";
        }
        displayText += " - " + originName;
    }
    
    button.textContent = displayText;
    
    // 设置当前书源样式
    if (sourceInfo.bookUrl == currentBookUrl && sourceInfo.origin == currentSourceUrl) {
        button.classList.add("modal-current");
    }
    
    return button;
}

// 动态更新书源样式
function updateSourceListStyle() {
    var sourceButtons = document.querySelectorAll(".sourceName");
    
    for (var i = 0; i < sourceButtons.length; i++) {
        var button = sourceButtons[i];
        var sourceIndex = parseInt(button.getAttribute('data-index'));
        var sourceInfo = bookSourceMapCache[sourceIndex];
        
        button.classList.remove("modal-current");
        if (sourceInfo && sourceInfo.bookUrl == currentBookUrl && sourceInfo.origin == currentSourceUrl) {
            button.classList.add("modal-current");
        }
    }
}

// 更新书源分页信息
function updateSourcePageInfo() {
    preloadLog("当前书源页码: " + currentSourcePage + "/" + totalSourcePages);
}

// 处理书源列表响应
function handleSourceListResponse(res, pageNo, pageSize) {
    sourceFetching = false;
    if (res && res.isSuccess) {
        var data = res.data;
        var list = [];
        var lastIndex = lastSourceIndex;
        var hasMore = false;

        if (data && data.books) {
            // xread-fpk：{ books, lastIndex, hasMore }
            list = data.books;
            lastIndex = data.lastIndex;
            hasMore = !!data.hasMore;
        } else if (data && data.list) {
            // 阅读3 兼容：{ list, lastIndex }
            list = data.list;
            lastIndex = data.lastIndex;
        } else if (Object.prototype.toString.call(data) === "[object Array]") {
            list = data;
        }
        list = list || [];

        var before = bookSourceMapCache.length;
        bookSourceMapCache = bookSourceMapCache.concat(list);
        if (typeof lastIndex === "number") {
            lastSourceIndex = lastIndex;
        }
        // 空批次说明服务端已无更多结果，避免继续请求造成死循环
        hasMoreSource = hasMore && bookSourceMapCache.length > before;

        // 目标页仍未填满且服务端还有更多结果时，继续拉取下一批
        if (hasMoreSource && pageNo * pageSize > bookSourceMapCache.length) {
            getSourceList(pageNo, pageSize, false);
            return;
        }

        disposeSourceList(bookSourceMapCache, pageNo, pageSize);
        updateSourcePageInfo();
    } else {
        errorLog(res ? res.errorMsg : "获取书源列表失败");
    }
    loadingOver();
}

// 获取书源列表
function getSourceList(pageNo, pageSize, refresh) {
    var needFetch = bookSourceMapCache.length === 0 || refresh ||
        (pageNo * pageSize > bookSourceMapCache.length && hasMoreSource && !sourceFetching);

    var params = {
        refresh: refresh ? 1 : 0,
        url: currentBookUrl,
        name: currentBookName,
        author: currentAuthor,
        // xread-fpk 用 resultLimit（单次结果条数）+ lastIndex（书源游标）分页
        resultLimit: sourceBatchSize,
        lastIndex: refresh ? -1 : (bookSourceMapCache.length === 0 ? -1 : lastSourceIndex),
        concurrentCount: 6
    };

    // 刷新或缓存为空时重新获取
    if (needFetch) {
        if (refresh || bookSourceMapCache.length === 0) {
            bookSourceMapCache = [];
            lastSourceIndex = -1;
            hasMoreSource = true;
        }
        sourceFetching = true;
        loadingP = $("#sourcing");
        loading();
        $("#sourceTitle").textContent = currentBookName;

        HttpGet(url(searchBookSource, params), function(res) {
            handleSourceListResponse(res, pageNo, pageSize);
        });
    } else {
        // 使用缓存数据分页显示
        loadingP = $("#sourcing");
        loading();
        disposeSourceList(bookSourceMapCache, pageNo, pageSize);
        updateSourcePageInfo();
        loadingOver();
    }
}

// 书源列表处理函数
function disposeSourceList(data, pageNo, pageSize) {
    if (!data || !data.length) {
        sourceColumn1.innerHTML = '<p style="text-align:center;padding:20px;font-size:43px;">暂无书源</p>';
        sourceColumn2.innerHTML = '';
        return;
    }
    
    // 计算分页
    totalSourcePages = Math.ceil(data.length / pageSize);
    if (pageNo < 1) pageNo = 1;
    if (pageNo > totalSourcePages) pageNo = totalSourcePages;
    currentSourcePage = pageNo;
    
    var startIndex = (pageNo - 1) * pageSize;
    var endIndex = Math.min(startIndex + pageSize, data.length);
    
    var fragment1 = document.createDocumentFragment();
    var fragment2 = document.createDocumentFragment();
    var isColumnFlag = true;
    
    // 创建当前页的书源按钮
    for (var index = startIndex; index < endIndex; index++) {
        var sourceInfo = data[index];
        var button = createSourceButton(sourceInfo, index);
        
        if (isColumnFlag) {
            fragment1.appendChild(button);
        } else {
            fragment2.appendChild(button);
        }
        isColumnFlag = !isColumnFlag; //重置标志
    }
    
    // 批量更新DOM
    sourceColumn1.innerHTML = '';
    sourceColumn2.innerHTML = '';
    sourceColumn1.appendChild(fragment1);
    sourceColumn2.appendChild(fragment2);
}

// 处理书源点击事件
function handleSourceClick(target) {
    if (target.classList.contains('sourceName')) {
        var newBookUrl = target.value;
        var sourceIndex = parseInt(target.getAttribute('data-index'));
        var sourceInfo = bookSourceMapCache[sourceIndex];
        if (newBookUrl == currentBookUrl) return;

        // 调用设置书源功能
        setReadSource(currentBookName, newBookUrl, currentBookUrl, sourceInfo.origin, currentSourceUrl);
        hide(".bookSourceList");
    }
}

function handleSourceResponse(res, name, newBookUrl) {
    if (res && res.isSuccess) {
        // 更新当前书籍信息
        currentBookUrl = newBookUrl;
        currentSourceUrl = res.data.origin || currentSourceUrl;
        // 更新书源列表样式
        updateSourceListStyle();
        // 换源后章节地址全部变化，必须重拉目录，再按原章节序号载入正文
        var targetIndex = parseInt(currentChapterIndex);
        bookChapterMapCache = null;
        getChapterList(1, showChapterListNum, false, function() {
            var maxIndex = bookChapterMapCache ? bookChapterMapCache.length - 1 : 0;
            if (isNaN(targetIndex) || targetIndex > maxIndex) {
                targetIndex = maxIndex > 0 ? maxIndex : 0;
            }
            getBookContentPage(targetIndex, currentBookUrl, 1);
        });
    } else {
        alert(res ? res.errorMsg : "设置书源失败");
    }
}

//设置新书源
function setReadSource(bookName, newBookUrl, oldBookUrl, newSourceUrl, oldSourceUrl) {
    var params = {
        refresh: 0,
        newUrl: newBookUrl,
        bookUrl: oldBookUrl,
        bookSourceUrl: newSourceUrl
    };

    if (config.type == "app") {
        HttpPost(url(setBookSource), params, function(res) {
            if (res && res.isSuccess) {
            handleSourceResponse(res, bookName, newBookUrl);
            } else {
               alert(res ? res.errorMsg : "设置书源失败！！！");
            }
        });
    } else {
        HttpPost(url(setBookSource), params, function(res) {
            if (res && res.isSuccess) {
                handleSourceResponse(res, bookName, newBookUrl);
            } else {
               alert(res ? res.errorMsg : "设置书源失败！！！");
            }
        });
    }
}

function doDeleteBook() {
    var params = {
        refresh: 1,
        url: currentBookUrl,
        // xread-fpk 的 deleteBook 接收 Book 结构，主键是 bookUrl
        bookUrl: currentBookUrl,
        origin: currentSourceUrl,
        name: currentBookName,
        author: currentAuthor
    };

    HttpPost(url(deleteBook), params, function(res) {
        if (res && res.isSuccess) {
            initCSSLoadStyle();
            getBookshelf();
            hide(".bookSourceList");
        } else {
            alert(res ? res.errorMsg : "删除书籍失败");
        }
    });
}

function initCSSLoadStyle() {
    hide(".c_bookshelf");
    hide(".c_bookContent");
    hide(".bookSourceList");
    hide(".menu");

    hide("#topMenu");
    hide("#bottomMenu");
    menusVisible = false;
}

function initCSSLoadValue() {
    // 普通输入框
    var inputIds = ['type', 'address', 'username', 'password', 'contentFontSize', 'letterSpacing', 'lineHeight'];
    inputIds.forEach(function(id) {
        var element = $("#" + id);
        if (element) {
            if (id === "address" && !config.address) {
                // fpk 部署时登录框默认填「飞牛本机地址」(= 当前访问的源)，
                // Kindle 老浏览器无需手输 IP:端口；清空也可用（apiBase 自动同源）。
                element.value = pageOrigin();
            } else {
                element.value = config[id] || element.value || "";
            }
            preloadLog("系统默认配置: " + id + " value: " + element.value);
        }
    });
    
    // 字体选择框
    var fontFamilyElement = $("#fontFamily");
    if (fontFamilyElement) {
        fontFamilyElement.value = config.fontFamily || fontFamilyElement.value || "";
        preloadLog("系统默认配置: fontFamily value: " + fontFamilyElement.value);
    }
    
    // 加粗复选框
    var fontWeightElement = $("#contentFontWight");
    if (fontWeightElement) {
        fontWeightElement.checked = (config.fontWeight === "bold");
        preloadLog("系统默认配置: contentFontWight checked: " + fontWeightElement.checked);
    }
}
            
// 统一的键盘点击事件处理
function initKindleEnterKey() {
    document.addEventListener('keydown', function(event) {
        var keyCode = event.which || event.keyCode;
        if (keyCode === 13) { // 回车键
            handleEnterKey();
            event.preventDefault();
        } else if (keyCode === 37) { // 向左键
            prePage();
            event.preventDefault();
        } else if (keyCode === 39) { // 向右键
            nextPage();
            event.preventDefault();
        }
    });
}

function handleEnterKey() {
    // 检查哪个模态框可见
    var fontConfig = $('.font-config');
    if (fontConfig && fontConfig.style.display === 'block') {
        // 设置项已即时生效，回车只做一次应用，不再关闭弹窗
        applyConfigLive();
        return;
    }
    
    var loginInterface = $('.c_login');
    if (loginInterface && loginInterface.style.display !== 'none') {
        login();
        return;
    }
}

// 模态框点击处理
function handleModalClick(target) {
    if (target.classList.contains('bookChapterList')) {
        hide(".bookChapterList");
    } else if (target.classList.contains('bookSourceList')) {
        hide(".bookSourceList");
    } else if (target.classList.contains('font-config')) {
        hide(".font-config");
    } else if (target.classList.contains('white')) {
        hide(".white"); 
    }
}

// 翻页手势内容点击处理函数
function handleContentClick(x, y) {
    // 如果菜单正在显示，点击内容区域应该关闭菜单
    if (menusVisible) {
        toggleMenus();
        return;
    }
    
    // 菜单隐藏时的正常翻页逻辑,根据不同的翻页方式记录方向
    var direction = 0;
    switch (config.currentClickFunNum) {
        case 1:
            direction = clickChangePage1(x, y);
            break;
        case 2:
            direction = clickChangePage2(x, y);
            break;
        case 3:
            direction = clickChangePage3(x, y);
            break;
        case 4:
            direction = clickChangePage4(x, y);
            break;
    }
    
    // 如果返回的方向为0，表示点击了中央区域，应该显示菜单
    if (direction === 0 && !menusVisible) {
        toggleMenus();
    } else {
        // 记录翻页方向用于预加载
        lastPageTurnDirection = direction;
    }
}

// 初始化翻页选项状态
function initPageOptions() {
    // 根据currentClickFunNum的值设置初始active状态
    var currentClickFunNum = config.currentClickFunNum;
    var selectedOption = document.getElementById('changePageFunNum' + currentClickFunNum).parentElement.parentElement;
    if (selectedOption && selectedOption.classList.contains('page-option')) {
        selectedOption.classList.add('active');
    }

    // 设置翻页单选按钮的checked状态
    var radioButton = document.querySelector('input[name="changePageFunNum"][value="' + currentClickFunNum + '"]');
    if (radioButton) {
        radioButton.checked = true;
    }
}

// 获取选中的radio按钮的值
function getChangePageFunNum() {
    var selectedRadio = document.querySelector('input[name="changePageFunNum"]:checked');
    if (selectedRadio) {
        return parseInt(selectedRadio.value);
    }
}

// 更新翻页选项的active状态
function changePageFunNum() {
    var currentValue = getChangePageFunNum();
    if (config.currentClickFunNum == currentValue) return;
    config.currentClickFunNum = currentValue;
    
    // 移除所有page-option的active类
    var pageOptions = document.querySelectorAll('.page-option');
    for (var i = 0; i < pageOptions.length; i++) {
        pageOptions[i].classList.remove('active');
    }
    
    // 为当前选中的选项添加active类
    initPageOptions();
}

var preScreenX = screenWidth / 3,
  nextScreenX = (screenWidth * 2) / 3;
// 左边上一页 右边下一页
function clickChangePage1(x, y) {
  if (x < preScreenX) {
    prePage();
    return -1; // 返回向上翻页方向
  } else if (x > nextScreenX) {
    nextPage();
    return 1; // 返回向下翻页方向
  }
  return 0; // 中央区域，用于显示菜单
}

// 点上边上一页，下边下一页
function clickChangePage2(x, y) {
  if ((y < screenHeight / 2) && (x < preScreenX || x > nextScreenX)) {
    prePage();
    return -1;
  } else if ((y > screenHeight / 2) && (x < preScreenX || x > nextScreenX)) {
    nextPage();
    return 1;
  }
  return 0; // 中央区域，用于显示菜单
}

// 左上角上一页，其余区域下一页
function clickChangePage3(x, y) {
  if ((y < screenHeight / 2) && x < preScreenX) {
    prePage();
    return -1;
  } else if (x > nextScreenX || (x < preScreenX && (y > screenHeight / 2))) {
    nextPage();
    return 1;
  }
  return 0; // 中央区域，用于显示菜单
}

// 右上角上一页，其余区域下一页
function clickChangePage4(x, y) {
  if ((y < screenHeight / 2) && x > nextScreenX) {
    prePage();
    return -1;
  } else if (x < preScreenX || (x > nextScreenX && (y > screenHeight / 2))) {
    nextPage();
    return 1;
  }
  return 0; // 中央区域，用于显示菜单
}
function debug(msg) {
    $("#debug").textContent = msg;
    show(".white");
}

// 阅读界面顶部底部菜单切换函数
function toggleMenus() {
    if (menusVisible) {
        hide("#topMenu");
        hide("#bottomMenu");
        menusVisible = false;
    } else {
        show("#topMenu");
        show("#bottomMenu");
        menusVisible = true;
    }
}

function updateElementFontStyle(element, fontFamily, fontSize, letterSpacing, lineHeight, fontWeight) {
    element.style.fontFamily = fontFamily;
    element.style.fontSize = fontSize;
    element.style.letterSpacing = letterSpacing;
    element.style.lineHeight = lineHeight;
    element.style.fontWeight = fontWeight;
}

// 更新字体配置
function updateFontConfig() {
    config.contentFontSize = parseInt($("#contentFontSize").value) || config.contentFontSize;
    config.letterSpacing = parseInt($("#letterSpacing").value) || config.letterSpacing;
    config.lineHeight = parseFloat($("#lineHeight").value) || config.lineHeight;
    config.fontFamily = $("#fontFamily").value || config.fontFamily;
    config.fontWeight = $("#contentFontWight").checked ? "bold" : "normal";// 字体加粗
}

// 应用字体设置
function applyFontSettings(targetPageNo) {
    // 获取配置值
    var fontSize = config.contentFontSize;
    var fontFamily = config.fontFamily;
    var lineHeight = config.lineHeight;
    var letterSpacing = config.letterSpacing;
    var menuRatio = config.menuFontSizeRatio;
    var fontWeight = config.fontWeight;

    // 字体映射表
    // 短名映射：下拉框显示名 = 配置项的值；保留旧名映射仅为兼容历史配置
    var fontFamilyMap = {
        '系统': 'system',
        '云朵': '"云朵字体", system',
        '圆体': '"糯米圆体", system',
        '楷体': '"御风楷体", system',
        '系统默认': 'system',
        '云朵字体': '"云朵字体", system',
        '糯米圆体': '"糯米圆体", system',
        '御风楷体': '"御风楷体", system',
        'system': 'system'
    };
    
    var appliedFontFamily = fontFamilyMap[fontFamily] || 'system';

    // 应用到内容区域
    if (contentElement) {
        updateElementFontStyle(contentElement, appliedFontFamily, fontSize + "px", 
            letterSpacing + "px", lineHeight, fontWeight);
    }
    
    // 应用到测量元素
    if (textMeasurer) {
        updateElementFontStyle(textMeasurer, appliedFontFamily, fontSize + "px", 
            letterSpacing + "px", lineHeight, fontWeight);
    }
    
    // 应用到信息区域,保持字体与内容区字体大小成比例
    if (menuElement) {
        var menuFontSize = Math.round(fontSize * menuRatio); //四舍五入
        updateElementFontStyle(menuElement, appliedFontFamily, menuFontSize + "px", 
            (letterSpacing * menuRatio) + "px", lineHeight , fontWeight);
    }

    // 重新渲染内容
    if (currentChapterIndex !== null && currentChapterContent) {
        disposeBookContent(currentChapterIndex, currentChapterContent);
        
        if (targetPageNo && targetPageNo > 0 && targetPageNo <= currentBookTotalPage) {
            currentBookPage = targetPageNo;
        }
        if (pageList && pageList.length > 0) {
            showContent(pageList);
        }
    }
}

// 设置项即时生效：选定即应用，不关闭设置弹窗
function applyConfigLive() {
    updateFontConfig();
    applyFontSettings(currentBookPage);
    changePageFunNum();
}

//临时配置（「完成」按钮：应用并关闭弹窗；选项本身已通过 change 即时生效）
function refreshConfig() {
    applyConfigLive();
    hide(".font-config");
}

// 统一的点击事件处理函数
function globalClickHandler(event) {
    var target = event.target;

    // 菜单显示时的外部点击处理
    if (menusVisible && !topMenu.contains(target) && !bottomMenu.contains(target)) { 
        // 如果点击不在菜单区域内，则关闭菜单,阻止继续处理其他点击逻辑
        toggleMenus();
        return; 
    }
    // 书架点击处理
    var bookItem = findParentWithClass(target, 'book-item');
    if (bookItem) {
        handleBookshelfClick(bookItem);
        return;
    }
    // 阅读区域点击处理
    var contentArea = findParentWithClass(target, 'c_bookContent');
    if (contentArea) {
        handleContentClick(event.clientX, event.clientY);
        return;
    }
    // 目录点击处理
    if (target.classList.contains('chapterName')) {
        handleChapterClick(target);
        return;
    }
    // 书源点击处理
    if (target.classList.contains('sourceName')) {
        handleSourceClick(target);
        return;
    }
    // 模态框外点击关闭
    if (target.classList.contains('modal')) {
        handleModalClick(target);
        return;
    }
}

function initEventHandlers() {
    // 移除旧的点击事件监听器（如果存在）
    document.removeEventListener('click', globalClickHandler);
    // 添加统一的点击事件处理器
    // WebKit534 第三参数只认布尔值；传对象会被当作 true（捕获阶段）且无法被 removeEventListener(false) 移除
    document.addEventListener('click', globalClickHandler, false);
    // 移除旧的滚动监听器
    window.removeEventListener('scroll', scrollHandler);
    // 添加滚动监听器
    window.addEventListener('scroll', scrollHandler, false);
    // 立即检查一次可见封面
    setTimeout(checkVisibleCovers, 100);
}

function initBookShelf() {
   if (config.type == "app") {
        accessToken = "app";
        hide('.serverSecured');
        getBookshelf();
    } else if (config.type == "single") {
        accessToken = "single";
        hide('.serverSecured');
        getBookshelf();
    } else {
        show(".c_login");
    }
}

function initBookElement() {
    contentElement = document.getElementById("bookContent");
    textMeasurer = document.getElementById("text-measurer");
    menuElement = document.getElementById("menu");
    topMenu = document.getElementById("topMenu");
    bottomMenu = document.getElementById("bottomMenu");
    chapterColumn1 = document.getElementById("chapterColumn1");
    chapterColumn2 = document.getElementById("chapterColumn2");
    sourceColumn1 = document.getElementById("sourceColumn1");
    sourceColumn2 = document.getElementById("sourceColumn2");
}

// 禁止输入框聚焦时页面被自动放大（Kindle / 老 WebKit 的 form-control auto zoom）。
// 关键手段是 CSS 的 -webkit-text-size-adjust:none（老内核唯一可靠值）。
// 这里只做两件低风险的事：阻止双指缩放手势；聚焦后把滚动位置归零。
// 不再在 focus/blur 时反复 setAttribute viewport —— 那会触发 viewport 重算，
// 反而可能造成页面跳动/放大（Kindle 上尤其明显）。
// Kindle 浏览器会在输入框聚焦时自行放大页面且无视 maximum-scale。
// 策略：聚焦时不干预（避免打断输入），失焦/resize/首屏后主动重写 viewport 复位缩放。
// 缩放复位：不再改写 viewport meta。
// 老 Kindle WebKit 一旦发现 viewport 的 content 被脚本改动，会整条重新解析并重置缩放状态，
// 表现为「点输入框/点设置后页面变大」，而且会和 resize 互相触发。原版（未适配前）从不改 viewport，
// 所以没有这个问题——这里只保留函数名做空实现，兼容既有调用点。
function forceViewportScale() {
    return;
}

// 复位整页缩放：重新挂一次 viewport meta，让浏览器按 initial-scale=1 重新校准。
// 老 Kindle 聚焦输入框时会自行放大（约 1.6 倍）并且失焦后不会自己缩回，
// 放大状态还会一路带到阅读页——表现为「顶部被切、一页字数变少」。
// 这里只在失焦 / 切换界面时调用，聚焦期间不做任何事，不打断输入。
function resetViewportScale() {
    // r22 回退：还原原始代码「不干预 viewport」的行为。
    // 原始代码聚焦输入框本就无放大问题；此复位是后期引入的 hack，已停用。
    return;
}

function initInputZoomGuard() {
    // r22 回退：还原原始代码「不干预聚焦缩放」的行为，空实现仅为兼容调用点。
    return;
}

/* r93) 字体配置区 −/+ 步进按钮
   点击后按 data-step-delta 增减对应输入框，钳制在 [min,max]；
   行距保留 1 位小数，字号/字距为整数；改值后派发 change 触发即时生效。
   纯 ES5 + DOM Level 2 事件，兼容 Kindle WebKit 534。 */
function initFontSteppers() {
    var btns = document.querySelectorAll('.fc-step-btn');
    var i;
    for (i = 0; i < btns.length; i++) {
        btns[i].addEventListener('click', function () {
            var targetId = this.getAttribute('data-step-target');
            var delta = parseFloat(this.getAttribute('data-step-delta'));
            var min = parseFloat(this.getAttribute('data-step-min'));
            var max = parseFloat(this.getAttribute('data-step-max'));
            var input = document.getElementById(targetId);
            if (!input || isNaN(delta)) return;
            var cur = parseFloat(input.value);
            if (isNaN(cur)) cur = isNaN(min) ? 0 : min;
            var next = cur + delta;
            if (!isNaN(min) && next < min) next = min;
            if (!isNaN(max) && next > max) next = max;
            // 行距步进 0.1，需保留 1 位小数避免 1.3000000000000003
            if (Math.abs(delta) < 1) {
                next = Math.round(next * 10) / 10;
                input.value = next.toFixed(1);
            } else {
                input.value = String(Math.round(next));
            }
            // 派发 change，复用即时生效链路（applyConfigLive）
            var evt = document.createEvent('HTMLEvents');
            evt.initEvent('change', true, true);
            input.dispatchEvent(evt);
        }, false);
    }
}

function initEventListeners() {
    // 登录按钮
    var loginBtn = document.querySelector('[data-action="login"]');
    if (loginBtn) {
        loginBtn.addEventListener('click', login);
    }
    // 登录卡片底部「注册 / 登录」模式切换
    var toggleLoginModeBtn = document.querySelector('[data-action="toggleLoginMode"]');
    if (toggleLoginModeBtn) {
        toggleLoginModeBtn.addEventListener('click', toggleLoginMode);
    }
    // 书架按钮
    var bookshelfBtn = document.querySelector('[data-action="getBookshelf"]');
    if (bookshelfBtn) {
        bookshelfBtn.addEventListener('click', getBookshelf);
    }
    // 注销按钮
    var logoutBtn = document.querySelector('[data-action="logout"]');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', logout);
    }
    // 目录按钮
    var chapterBtn = document.querySelector('[data-action="showChapterList"]');
    if (chapterBtn) {
        chapterBtn.addEventListener('click', showChapterList);
    }
    // 设置按钮：打开前重新同步一次输入框显示值（选项已改为即时生效）
    var configBtn = document.querySelector('[data-action="show"][data-target=".font-config"]');
    if (configBtn) {
        configBtn.addEventListener('click', function() {
        initCSSLoadValue();
        initBookMgmt();
        show(this.getAttribute('data-target'));
        // 弹窗显示后才能量到真实宽度：立刻量一次，等老内核完成重排再量一次
        alignFontBox();
        setTimeout(alignFontBox, 120);
        setTimeout(alignFontBox, 400);
    });
    }
    // 关于本机入口：打开前刷新一次信息（缩放等读数随视口变化，保证每次看到的是最新的）
    var aboutEntry = document.querySelector('.about-entry');
    if (aboutEntry) {
        aboutEntry.addEventListener('click', function () {
            updateDeviceInfo();
            show(this.getAttribute('data-target'));
        }, false);
    }
    // 设置项已即时生效，「完成」按钮已移除；关闭请点右上角 ×
    // 设置项选定即生效：无需再点「完成」按钮
    var liveIds = ['fontFamily', 'contentFontSize', 'letterSpacing', 'lineHeight', 'contentFontWight'];
    for (var li = 0; li < liveIds.length; li++) {
        var liveEl = document.getElementById(liveIds[li]);
        if (liveEl) {
            liveEl.addEventListener('change', function () {
                applyConfigLive();
                alignFontBox();
            });
        }
    }
    // r93) 字体配置区 −/+ 步进按钮：改值后手动派发 change，复用上面的即时生效链路
    initFontSteppers();
    var pageRadios = document.querySelectorAll('input[name="changePageFunNum"]');
    for (var ri = 0; ri < pageRadios.length; ri++) {
        pageRadios[ri].addEventListener('change', applyConfigLive);
    }
    // 目录刷新按钮
    var refreshChapterBtn = document.querySelector('[data-action="getChapterList"]');
    if (refreshChapterBtn) {
        refreshChapterBtn.addEventListener('click', function() {
        getChapterList(1, showChapterListNum, true);
    });
    }
    // 目录上一页按钮
    var prevChapterBtn = document.querySelector('[data-action="jumpChapterList"][data-args="-1"]');
    if (prevChapterBtn) {
        prevChapterBtn.addEventListener('click', function() {
        jumpChapterList(-1);
    });
    }
    // 目录下一页按钮
    var nextChapterBtn = document.querySelector('[data-action="jumpChapterList"][data-args="1"]');
    if (nextChapterBtn) {
        nextChapterBtn.addEventListener('click', function() {
            jumpChapterList(1);
        });
    }
    // 移除书籍按钮（书源切换按钮已停用：更多书源 / 上一页 / 下一页）
    var deleteBookBtn = document.querySelector('[data-action="deleteBookItem"]');
    if (deleteBookBtn) {
        deleteBookBtn.addEventListener('click', showDeletePanel);
    }
    var confirmDeleteChk = document.getElementById("confirmDeleteCheck");
    if (confirmDeleteChk) {
        confirmDeleteChk.addEventListener('change', onConfirmDeleteChange);
    }
    var cacheBookBtn = document.querySelector('[data-action="cacheBookItem"]');
    if (cacheBookBtn) {
        cacheBookBtn.addEventListener('click', cacheCurrentBook);
    }
    // 移动书籍：展开分组面板；选择分组即时生效
    var moveBookBtn = document.querySelector('[data-action="moveBookItem"]');
    if (moveBookBtn) {
        moveBookBtn.addEventListener('click', showMoveBookPanel);
    }
    var groupSel = document.getElementById("bookGroupSelect");
    if (groupSel) {
        groupSel.addEventListener('change', moveBookToGroup);
    }
    // 设置页：书籍管理功能区（四个按钮 + 分组下拉 + 删除勾选）
    var mgmtBtns = document.querySelectorAll('[data-bookmgmt]');
    for (var mi = 0; mi < mgmtBtns.length; mi++) {
        mgmtBtns[mi].addEventListener('click', function () {
            setBookMgmtTab(this.getAttribute('data-bookmgmt'));
        });
    }
    var mgmtSel = document.getElementById("mgmtGroupSelect");
    if (mgmtSel) {
        // 选择分组不立即生效：仅提示，须点击「移动分组」按钮才执行
        mgmtSel.addEventListener('change', function () {
            bmStatus("已选分组，点「移动分组」生效");
        });
    }
    
    // 所有关闭按钮 - 使用兼容的循环
    var hideButtons = document.querySelectorAll('[data-action="hide"]');
    for (var i = 0; i < hideButtons.length; i++) {
        hideButtons[i].addEventListener('click', function() {
            var tgt = this.getAttribute('data-target');
            hide(tgt);
            // 移出过书籍：等用户关掉设置页再刷新书架，避免打断查看移出结果
            if (tgt === ".font-config" && bookMgmtNeedShelfRefresh) {
                bookMgmtNeedShelfRefresh = false;
                bookMgmtRemoveArmed = false;
                bookMgmtRemoveArmedUrl = "";
                bmSetStatus("各卡片操作结果");
                getBookshelf();
            }
        });
    }
}

function load() {
    freshTime();
    //隐藏不必要的CSS窗口
    initCSSLoadStyle();
    //获取需要的DOM引用
    initBookElement();
    // 应用默认字体设置
    applyFontSettings();
    //初始化对话框值
    initCSSLoadValue();
    // 初始化对话框选项
    initPageOptions();
    // 事件监听器函数
    initEventListeners();
    // 禁止输入框聚焦时页面被自动放大
    initInputZoomGuard();
    //初始化统一的事件处理器
    initEventHandlers();
    //统一的键盘事件处理
    initKindleEnterKey();
    // 封面懒加载初始化
    initCoverLazyLoad();
    // 初始化书架 
    initBookShelf();
}

// 检查登录状态并切换界面
function checkLoginState() {
      if (accessToken) {
        // 登录成功后复位一次缩放：避免在登录框里被浏览器放大后，放大状态被带进书架/阅读页
        resetViewportScale();
        hide(".c_login");
        show(".c_bookshelf");
        show(".menu");
        hide(".c_bookContent");
        return true;
    } else {
        show(".c_login");
        hide(".c_bookshelf");
        hide(".c_bookContent");
        // 书籍管理与书架管理一样，未登录时隐藏：
        // .bookSourceList 是顶层模态框(z-index 1100)，高于登录界面(1000)，不显式关闭会穿透登录页；
        // #topMenu 内含书籍管理入口按钮，一并隐藏，避免未登录触达管理功能。
        hide(".bookSourceList");
        hide("#topMenu");
        hide("#bottomMenu");
        menusVisible = false;
        return false;
    }
}

// 检查全屏支持情况
function isFullScreenSupported() {
    var elem = document.documentElement;
    return !!(
        elem.requestFullscreen ||
        elem.webkitRequestFullscreen ||
        elem.mozRequestFullScreen ||
        elem.msRequestFullscreen
    );
}

// 检查当前是否全屏
function isInFullscreen() {
    return !!(
        document.fullscreenElement ||
        document.webkitFullscreenElement ||
        document.mozFullScreenElement ||
        document.msFullscreenElement
    );
}

function enterStandardFullscreen() {
    var elem = document.documentElement;
    
    try {
        if (elem.requestFullscreen) {
            elem.requestFullscreen();
        } else if (elem.webkitRequestFullscreen) {
            elem.webkitRequestFullscreen();
        } else if (elem.mozRequestFullScreen) {
            elem.mozRequestFullScreen();
        } else if (elem.msRequestFullscreen) {
            elem.msRequestFullscreen();
        } else {
            throw new Error('No fullscreen support');
        }
    } catch (e) {
        enterKindleFullscreen();
    }
}

function exitStandardFullscreen() {
    if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen();
    } else if (document.webkitFullscreenElement && document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
    } else if (document.mozFullScreenElement && document.mozCancelFullScreen) {
        document.mozCancelFullScreen();
    } else if (document.msFullscreenElement && document.msExitFullscreen) {
        document.msExitFullscreen();
    }

    // 恢复滚动位置
    window.scrollTo(0, 0);
}

// 检测Kindle浏览器更精确的方法
function isKindleBrowser() {
    var ua = navigator.userAgent;
    // 匹配Kindle设备特有的用户代理字符串
    return (
        ua.indexOf('Linux armv7l') !== -1 && 
        ua.indexOf('AppleWebKit/534.26+') !== -1 &&
        ua.indexOf('Safari/534.26+') !== -1
    );
}

// Kindle专用全屏进入方法
function enterKindleFullscreen() {
}

// Kindle专用全屏退出方法
function exitKindleFullscreen() {
}

function enterFullscreen() {
    if (isFullScreenSupported()) {
        enterStandardFullscreen();
    } else if (isKindleBrowser()) {
        enterKindleFullscreen(); 
    }
}

function exitFullscreen() {
    if (isInFullscreen()) {
        exitStandardFullscreen();
    } else if (isKindleBrowser()) {
        exitKindleFullscreen(); 
    }
}

function loginBookshelf() {
    var type = config.type;

    if (type == "app") {// 手机应用模式
        accessToken = "app";
        hide('.serverSecured');
        getBookshelf();
        return;
    } else if (type == "single") {// 单用户模式
        accessToken = "single";
        hide('.serverSecured');
        getBookshelf();
        return;
    } else if (type == "multi") {// 多用户模式
        config.username = $("#username").value;
        config.password = $("#password").value;
        clearLoginError();
        if (!config.username || !config.password) {
            showLoginError(loginMode === "register" ? "请填写用户名和密码" : "请输入用户名和密码");
            return;
        }

        var params = {
                isLogin: (loginMode !== "register"),
                username: config.username,
                password: decode(config.password),
                code: ""
            };
    
        HttpPost(url(login_url), params, function(res) {
            if (res && res.isSuccess) {
                accessToken = res.data.accessToken;
                clearLoginError();
                getBookshelf();
            } else {
                show("#login");
                accessToken = null;
                showLoginError(res && res.errorMsg ? res.errorMsg :
                    (loginMode === "register" ? "注册失败，请稍后重试" : "用户名或密码错误"));
            }
            loadingOver();
        }, function(reason) {
            show("#login");
            accessToken = null;
            showLoginError(reason);
            loadingOver();
        });
    } else {
        showLoginError('服务器类型设置失败！');
    }
}

function updateLoginConfig(){
    loadingP = $("#logining");
    config.type = $("#type").value;
    config.address = $("#address").value.trim() || pageOrigin();
}

function login() {
    // 点「登录」时先把被浏览器放大的整页缩回 1:1：
    // 老 Kindle 聚焦输入框后会一直停在放大状态，若不在这里复位，
    // 放大会被原封不动地带进书架和阅读页（表现为正文顶部被切、一页字数变少）。
    resetViewportScale();
    // 页面值获取
    updateLoginConfig();
    // 登录书架
    loginBookshelf();
}

function cleanupTimers() {
    if (preloadTimer) {
        clearTimeout(preloadTimer);
        preloadTimer = null;
    }
    if (lazyScrollTimeout) {
        clearTimeout(lazyScrollTimeout);
        lazyScrollTimeout = null;
    }
}

function cleanupMapCache() {
    // 限制预加载章节缓存大小
    var cacheKeys = Object.keys(preloadedChaptersMapCache);
    if (cacheKeys.length > preloadCount * 3) {
        var keysToDelete = cacheKeys.slice(0, cacheKeys.length - preloadCount * 2);
        for (var i = 0; i < keysToDelete.length; i++) {
            var key = keysToDelete[i];
            delete preloadedChaptersMapCache[key];
        }
    }
    
    // 限制封面缓存大小
    var coverKeys = Object.keys(lazyLoadedCovers);
    if (coverKeys.length > lazyLoadedCovers * 10) { // 限制封面缓存
        var coversToDelete = coverKeys.slice(0, coverKeys.length - 30);
        for (var j = 0; j < coversToDelete.length; j++) {
            var coverKey = coversToDelete[j];
            delete lazyLoadedCovers[coverKey];
        }
    }
    
    // 清理缓存
    preloadedChaptersMapCache = {};
    lazyLoadedCovers = {};
    bookSourceMapCache = [];
    
    // 重置其他全局状态
    lazyLoadInitialized = false;
    menusVisible = false;
}

function sendLogoutRequest() {
    if (config.type == "multi" || config.type == "single") {
        HttpPost(url(logout_url), null, function() {
            loadingOver();
        });
        show('.serverSecured');
    }
    accessToken = null;
}

function sendsaveReadRequest() {
    if (currentChapterIndex !== null && currentBookUrl) {
        preloadLog("退出登录前保存进度");
        saveReadProcessSync(currentChapterIndex, currentBookUrl);
    }
}

function logout() {
    // 退出前保存当前阅读进度
    sendsaveReadRequest();
    // 立即停止所有定时器和异步操作
    cleanupTimers();
    cleanupLazyLoad();
    // 重置界面状态
    initCSSLoadStyle();
    // 发送注销请求并清除本地认证
    sendLogoutRequest();
    // 清理数据缓存
    cleanupMapCache();
    // 退出全屏
    exitFullscreen();
    // 显示登录界面
    show(".c_login");
    
    // 注意：保持事件监听器活跃，确保登录界面功能正常
    // 如果需要重新初始化，可以在这里调用：
    // initEventListeners();
}

document.addEventListener('DOMContentLoaded', function() {
    // 完整兼容性检查（调试用）
    //checkKindleCompatibility();
    //debugBrowserInfo();
    // 加载应用
    load();
    updateDeviceInfo();
    // 缩放/横竖屏/地址栏收起都会改视口，这里同步刷新设备信息（只读，不干预布局）
    window.addEventListener('resize', function () {
        updateDeviceInfo();
        alignFontBox();
    }, false);

});

/* 设置页「设备信息」区：常驻显示，用来确认三件事
   1) Kindle 强缓存有没有骗人——前端版本号是否为自己刚装的这版；
   2) 页面到底跑在什么视口下（视口 vs 屏幕 的差就是浏览器 UI 占掉的高度）；
   3) 有没有被整页放大——「缩放」一栏 = 布局宽度 / 可视宽度，正常是 100%，
      点输入框被放大后会大于 100%，这样不用猜也能判断问题在浏览器还是页面。 */
function updateDeviceInfo() {
    function setText(id, text) {
        var el = document.getElementById(id);
        if (el) { el.innerHTML = text; }
    }
    // 前端资源版本：从 css 的 ?v= 参数取，构建时由 build.sh 注入
    var tag = '';
    var links = document.querySelectorAll('link');
    var i, href;
    for (i = 0; i < links.length; i++) {
        href = links[i].getAttribute('href') || '';
        if (href.indexOf('?v=') >= 0) {
            tag = href.substring(href.indexOf('?v=') + 3);
            break;
        }
    }
    // r43) 应用版本：优先前端代码内明确版本号 frontVersion（构建注入），回退 CSS ?v=
    var frontVer = (window.__XREAD_CONFIG__ && window.__XREAD_CONFIG__.frontVersion) || "";
    setText('devVersion', frontVer ? ('v' + frontVer) : (tag ? ('v' + tag) : '开发预览'));

    // 服务端版本：构建时由 build.sh 从后端 Cargo.toml 读取真实版本注入 appVersion
    // （即后端 Rust 二进制版本 1.0.48，与发布包版本无关，后端代码不更新）
    var cfg = window.__XREAD_CONFIG__ || {};
    setText('devServerVersion', cfg.appVersion ? ('v' + cfg.appVersion) : '—');

    var sw = (window.screen && screen.width) ? screen.width : 0;
    var sh = (window.screen && screen.height) ? screen.height : 0;
    setText('devScreen', sw + '×' + sh);

    var vw = window.innerWidth || 0;
    var vh = window.innerHeight || 0;
    setText('devViewport', vw + '×' + vh);

    var dpr = window.devicePixelRatio || 1;
    setText('devDpr', String(Math.round(dpr * 1000) / 1000));

    // 布局视口宽度不受整页缩放影响，可视宽度会——两者之比即当前缩放
    var layoutW = document.documentElement.clientWidth || vw;
    var zoom = vw ? Math.round(layoutW / vw * 1000) / 10 : 100;
    setText('devZoom', zoom + '%' + (zoom > 101 ? '（页面被放大）' : ''));
}

/* 让「字体」下拉框与右侧「字号」输入框外框严格等宽。
   原因：老 Kindle WebKit 的 <select> 不遵守 box-sizing:border-box，
   CSS 里写多少 px 只是内容宽，实际外框还要加内边距和边框，所以总比 input 长一点点。
   这里不再依赖盒模型假设，直接拿两个元素的实际 offsetWidth 做差，迭代修正 2~3 次，
   任何内核都能对齐到像素级；若内核根本不接受 width（极端情况），最多 3 次后放弃，不会死循环。 */
function alignFontBox() {
    // r21：宽度回归 r5 真机验证写法——#fontFamily 用 184px content-box（外框 200px），
    // input.number-input 用 200px border-box（外框 200px），两者纯 CSS 即精确对齐。
    // 任何 JS 运行时宽度篡改（r19 的 offsetWidth 迭代）在老内核 WebKit 534 上都帮倒忙，
    // 故彻底停用；保留空函数仅为兼容既有调用点。
    return;
}
