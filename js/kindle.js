// 配置 - 从外部配置文件读取
var config = window.READER_CONFIG || {
    type: "multi",
    address: "",
    username: "",
    password: "",
    salt: "",
    contentFontSize: 47,
    lineHeight: 1.3,
    fontFamily: "system",
    fontWeight: "normal",
    letterSpacing: 7,
    menuFontSizeRatio: 0.5,
    currentClickFunNum: 4,
    debugMode: false,
    debugLevel: 0
};
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
    deleteBook = "deleteBook";
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
    return config.address + router;
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
    
    var lines = content.split('\n');
    var formattedLines = [];
    
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        
        // 去除空行
        if (line === '') {
            continue;
        }
        
        // 段落缩进 - 简化条件判断
        if (line.indexOf(indentSpaces) !== 0) {
            line = indentSpaces + line;
        }
        
        formattedLines.push(line);
    }
    
    return formattedLines.join('\n');
}

//获取字符串
function getValue(str) {
    return str ? formatChapterTitle(str.trim()) : "";
}

//更新时间 时分
function freshTime() {
  //$("#nowTime").textContent = formatTime("HH:mm");
}

function loading() {
  loadingP.style.display = "inline-block";
}

function loadingOver() {
  loadingP.style.display = "none";
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

function HttpGet(url, callback) {
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
                }
            } else {
                console.error("Request failed with status: " + xhr.status);
                loadingOver();
            }
        }
    };
    
    if (config.type == "multi") {
        xhr.withCredentials = true;
    }
    
    xhr.send();
}

function HttpPost(url, data, callback) {
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
                }
            } else {
                console.error("Request failed with status: " + xhr.status);
                loadingOver();
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
    const bookItem = document.createElement('div');
    bookItem.className = 'book-item';
    
    // 处理封面URL
    var coverUrl = book.coverUrl;
    if (book.customCoverUrl) {
        coverUrl = book.customCoverUrl;
    }

    if (!coverUrl) {
        coverUrl = "img/noCover.jpg";
    } else if (coverUrl.indexOf('http') !== 0) {
        coverUrl = config.address + coverUrl;
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
        img.classList.remove('lazy-cover', 'cover-loading');
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
    // 格式化章节内容
    bookStr = currentChapterName + "<br/>" + formatChapterContent(bookStr);
    currentBookPage = 1;
    pageList = calculateCharsPerPage(bookStr);
    currentBookTotalPage = pageList.length;
}

// 显示当前页内容
function showContent(pages) {
    if (currentBookPage > currentBookTotalPage) {
        currentBookPage = currentBookTotalPage;
    }
    contentElement.innerHTML = pages[currentBookPage - 1].replace(/\n/g, '<br>');
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
        currentChapterIndex = targetChapterIndex;
    } else {
        errorLog("进度保存失败: " + (res ? res.errorMsg : "未知错误"));
    }
    loadingOver();
}

// 同步保存进度（用于页面卸载等关键场景）
function saveReadProcessSync(targetChapterIndex, bookUrl) {
    if (!targetChapterIndex || !bookUrl) return;
    
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

// 使用隐藏的div测量文本高度
function textMeasurerHigh(text) {
    if (!textMeasurer) return 0;
    // 获取内容元素的计算样式
    var computedStyle = window.getComputedStyle(contentElement); 
    // 应用关键样式到测量元素
    textMeasurer.style.fontFamily = computedStyle.fontFamily;
    textMeasurer.style.fontSize = computedStyle.fontSize;
    textMeasurer.style.letterSpacing = computedStyle.letterSpacing;
    textMeasurer.style.lineHeight = computedStyle.lineHeight;
    // 确保测量元素与内容元素具有相同的宽度和内边距
    textMeasurer.style.width = computedStyle.width;
    // 应用内容元素的内边距
    textMeasurer.style.paddingLeft = computedStyle.paddingLeft;
    textMeasurer.style.paddingRight = computedStyle.paddingRight;
    textMeasurer.style.paddingTop = computedStyle.paddingTop;
    textMeasurer.style.paddingBottom = computedStyle.paddingBottom;
    // 重置可能影响测量的样式
    textMeasurer.style.margin = "0";
    textMeasurer.style.border = "none";
    textMeasurer.style.boxSizing = "border-box";
    // 设置文本内容
    textMeasurer.innerHTML = text.replace(/\n/g, '<br>');
    // 返回精确高度
    return textMeasurer.offsetHeight;
}

// 计算每页显示的字符内容
function calculateCharsPerPage(bookStr) {
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
    if (pageNo <= 0) {
        if (currentChapterIndex <= 0 && currentBookPage <= 1) {
            loadingOver();
            return;
        }
        if (currentBookPage <= 1) {
            getBookContentPage(currentChapterIndex - 1, bookUrl, 0, true);
            return;
        }
        pageNo = currentBookPage - 1;
    } else if (pageNo > currentBookTotalPage) {
        if (currentChapterIndex >= bookChapterMapCache.length - 1 && 
            currentBookPage >= currentBookTotalPage) {
            loadingOver();
            return;
        }
        if (currentBookPage >= currentBookTotalPage) {
            getBookContentPage(currentChapterIndex + 1, bookUrl, 1, false);
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

// 显示书源列表
function showSourceList() {
    currentSourcePage = 1; // 重置为第一页
    getSourceList(1, sourcePageSize, false);
    show(".bookSourceList");
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

function deleteBookItem() {
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
            element.value = config[id] || element.value || "";
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
        refreshConfig();
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
    var fontFamilyMap = {
        'system': 'system',
        '世间美好': '"世间美好", system',
        '御风楷体': '"御风楷体", system',
        '云朵字体': '"云朵字体", system',
        '糯米圆体': '"糯米圆体", system',
        '方正品尚': '"方正品尚", system'
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

//临时配置
function refreshConfig() {
    // 更新字体配置
    updateFontConfig();
    // 直接应用字体设置
    applyFontSettings(currentBookPage);
    // 更新翻页选项状态（确保与当前设置一致）
    changePageFunNum();
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
    document.addEventListener('click', globalClickHandler, { passive: true });
    // 移除旧的滚动监听器
    window.removeEventListener('scroll', scrollHandler);
    // 添加滚动监听器
    window.addEventListener('scroll', scrollHandler, { passive: true });
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

function initEventListeners() {
    // 登录按钮
    var loginBtn = document.querySelector('[data-action="login"]');
    if (loginBtn) {
        loginBtn.addEventListener('click', login);
    }
    // 书架按钮
    var bookshelfBtn = document.querySelector('[data-action="getBookshelf"]');
    if (bookshelfBtn) {
        bookshelfBtn.addEventListener('click', getBookshelf);
    }
    // 书源按钮
    var sourceBtn = document.querySelector('[data-action="showSourceList"]');
    if (sourceBtn) {
        sourceBtn.addEventListener('click', showSourceList);
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
    // 设置按钮
    var configBtn = document.querySelector('[data-action="show"][data-target=".font-config"]');
    if (configBtn) {
        configBtn.addEventListener('click', function() {
        show(this.getAttribute('data-target'));
    });
    }
    // 字体配置确定按钮
    var refreshConfigBtn = document.querySelector('[data-action="refreshConfig"]');
    if (refreshConfigBtn) {
        refreshConfigBtn.addEventListener('click', refreshConfig);
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
    // 更多书源按钮
    var moreSourceBtn = document.querySelector('[data-action="getSourceList"]');
    if (moreSourceBtn) {
        moreSourceBtn.addEventListener('click', function() {
            var args = this.getAttribute('data-args');
            if (args) {
                var argArray = args.split(',');
                getSourceList(currentSourcePage+1, sourcePageSize, true);
            }
        });
    }

    // 书源上一页按钮
    var prevSourcePageBtn = document.querySelector('[data-action="prevSourcePage"]');
    if (prevSourcePageBtn) {
        prevSourcePageBtn.addEventListener('click', function() {
            jumpSourcePage(-1);
        });
    }
    
    // 书源下一页按钮
    var nextSourcePageBtn = document.querySelector('[data-action="nextSourcePage"]');
    if (nextSourcePageBtn) {
        nextSourcePageBtn.addEventListener('click', function() {
            jumpSourcePage(1);
        });
    }
    
    // 移除书籍按钮
    var deleteBookBtn = document.querySelector('[data-action="deleteBookItem"]');
    if (deleteBookBtn) {
        deleteBookBtn.addEventListener('click', deleteBookItem);
    }
    
    // 所有关闭按钮 - 使用兼容的循环
    var hideButtons = document.querySelectorAll('[data-action="hide"]');
    for (var i = 0; i < hideButtons.length; i++) {
        hideButtons[i].addEventListener('click', function() {
            hide(this.getAttribute('data-target'));
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
        hide(".c_login");
        show(".c_bookshelf");
        show(".menu");
        hide(".c_bookContent");
        return true;
    } else {
        show(".c_login");
        hide(".c_bookshelf");
        hide(".c_bookContent");
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

        var params = {
                isLogin: true,
                username: config.username,
                password: decode(config.password),
                code: ""
            };
    
        HttpPost(url(login_url), params, function(res) {
            if (res && res.isSuccess) {
                accessToken = res.data.accessToken;
                getBookshelf();
            } else {
                show("#login");
                accessToken = null;
                alert(res ? res.errorMsg : "登录失败");
            }
            loadingOver();
        });
    } else {
        alert('服务器类型设置失败！');
    }
}

function updateLoginConfig(){
    loadingP = $("#logining");
    config.type = $("#type").value;
    config.address = $("#address").value || location.host;
}

function login() {
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

});
