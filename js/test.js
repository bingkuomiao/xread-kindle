// 检查 Kindle 浏览器兼容性
function checkKindleCompatibility() {
    var results = [];
    
    // 检查关键 DOM API 支持
    var domApisToCheck = [
        'getBoundingClientRect',
        'querySelector',
        'querySelectorAll',
        'addEventListener',
        'removeEventListener'
    ];
    
    for (var i = 0; i < domApisToCheck.length; i++) {
        var api = domApisToCheck[i];
        var isSupported = false;
        
        switch(api) {
            case 'getBoundingClientRect':
                var testEl = document.createElement('div');
                isSupported = typeof testEl.getBoundingClientRect === 'function';
                break;
            case 'querySelector':
            case 'querySelectorAll':
            case 'addEventListener':
            case 'removeEventListener':
                isSupported = typeof document[api] === 'function';
                break;
        }
        
        results.push(api + ': ' + (isSupported ? '✓' : '✗'));
    }
    
    // 专门检查 classList API
    results.push('--- classList API ---');
    var testEl = document.createElement('div');
    var classListTests = [
        { name: 'classList.exists', test: !!testEl.classList },
        { name: 'classList.add', test: !!testEl.classList && typeof testEl.classList.add === 'function' },
        { name: 'classList.remove', test: !!testEl.classList && typeof testEl.classList.remove === 'function' },
        { name: 'classList.contains', test: !!testEl.classList && typeof testEl.classList.contains === 'function' },
        { name: 'classList.toggle', test: !!testEl.classList && typeof testEl.classList.toggle === 'function' }
    ];
    
    for (var j = 0; j < classListTests.length; j++) {
        var test = classListTests[j];
        results.push(test.name + ': ' + (test.test ? '✓' : '✗'));
    }
    
    // 检查 closest API
    results.push('--- Element.closest ---');
    var closestSupported = typeof testEl.closest === 'function';
    results.push('Element.closest: ' + (closestSupported ? '✓' : '✗'));
     /*
    // 检查事件相关 API
    results.push('--- 事件相关 API ---');
    var eventApis = [
        { name: 'event.target', test: typeof Event !== 'undefined' && 'target' in Event.prototype },
        { name: 'preventDefault', test: typeof Event !== 'undefined' && 'preventDefault' in Event.prototype },
        { name: 'stopPropagation', test: typeof Event !== 'undefined' && 'stopPropagation' in Event.prototype }
    ];
    
    for (var m = 0; m < eventApis.length; m++) {
        var eventApi = eventApis[m];
        results.push(eventApi.name + ': ' + (eventApi.test ? '✓' : '✗'));
    }

    // 检查 XMLHttpRequest
    results.push('--- 网络请求 API ---');
    var xhrSupported = typeof XMLHttpRequest !== 'undefined';
    results.push('XMLHttpRequest: ' + (xhrSupported ? '✓' : '✗'));
    */
    // 检查懒加载 API
    results.push('--- 懒加载 API ---');
    var otherApis = [
        { name: 'Image', test: !!window.Image },
        { name: 'setTimeout', test: !!window.setTimeout },
        { name: 'clearTimeout', test: !!window.clearTimeout }
    ];
    
    for (var k = 0; k < otherApis.length; k++) {
        var otherApi = otherApis[k];
        results.push(otherApi.name + ': ' + (otherApi.test ? '✓' : '✗'));
    }
    
    // 检查 CSS 相关支持
    results.push('--- CSS 相关支持 ---');
    var style = document.documentElement.style;
    var cssTests = [
        { name: 'CSS BoxSizing', test: 'boxSizing' in style },
        { name: 'CSS Flexbox', test: 'flex' in style || 'webkitFlex' in style },
        { name: 'CSS Transforms', test: 'transform' in style || 'webkitTransform' in style }
    ];
    
    for (var n = 0; n < cssTests.length; n++) {
        var cssTest = cssTests[n];
        results.push(cssTest.name + ': ' + (cssTest.test ? '✓' : '✗'));
    }
    
    // 汇总结果
    var totalTests = results.length;
    var passedTests = results.filter(function(result) {
        return result.indexOf('✓') > -1;
    }).length;
    
    results.unshift('=== 浏览器兼容性检查 ===');
    results.push('=== 汇总 ===');
    results.push('通过测试: ' + passedTests + '/' + totalTests);
    results.push('兼容性评分: ' + Math.round((passedTests / totalTests) * 100) + '%');
    
    // 显示结果
    var resultText = results.join('\n');
    
    // 尝试使用 alert 显示，如果 alert 不可用则输出到控制台
    if (typeof alert === 'function') {
        alert(resultText);
    } else if (console && console.log) {
        console.log(resultText);
    } else {
        // 最后的手段：显示在页面上
        var debugDiv = document.getElementById('debug');
        if (debugDiv) {
            debugDiv.textContent = resultText;
            debugDiv.style.whiteSpace = 'pre-wrap';
            show('.white');
        }
    }
    
    return {
        totalTests: totalTests,
        passedTests: passedTests,
        score: Math.round((passedTests / totalTests) * 100),
        details: results
    };
}

// 调试函数：显示浏览器信息（使用alert）
function debugBrowserInfo() {
    var info = [
        '=== 浏览器信息 ===',
        '用户代理: ' + navigator.userAgent,
        '屏幕尺寸: ' + screen.width + 'x' + screen.height,
        '视口尺寸: ' + window.innerWidth + 'x' + window.innerHeight,
        'Kindle检测: ' + (isKindleBrowser() ? '是' : '否'),
        '全屏支持: ' + (isFullScreenSupported() ? '是' : '否'),
        '当前全屏: ' + (isInFullscreen() ? '是' : '否'),
        '================='
    ].join('\n');
    
    alert(info);
}

/**
 * 获取缓存状态信息（新增函数，用于调试）
 */
function getCacheStatus() {
    var cacheKeys = Object.keys(preloadedChaptersMapCache);
    var currentIndex = currentChapterIndex || 0;
    var nearbyChapters = [];
    var farChapters = [];
    for (var i = 0; i < cacheKeys.length; i++) {
        var chapterIndex = parseInt(cacheKeys[i]);
        var distance = Math.abs(chapterIndex - currentIndex);
        if (distance <= preloadCount) {
            nearbyChapters.push(chapterIndex);
        } else {
            farChapters.push(chapterIndex);
        }
    }
    nearbyChapters.sort(function(a, b) { return a - b; });
    farChapters.sort(function(a, b) { return a - b; });
    return {
        total: cacheKeys.length,
        nearby: nearbyChapters,
        far: farChapters,
        memoryUsage: estimateCacheMemoryUsage() + 'KB',
        currentChapter: currentIndex
    };
}

// 调试函数：在控制台显示缓存状态
function debugCacheStatus() {
    var status = getCacheStatus();
    console.group('预加载缓存状态');
    preloadLog('总缓存章节:', status.total);
    preloadLog('附近章节:', status.nearby);
    preloadLog('较远章节:', status.far);
    preloadLog('内存使用:', status.memoryUsage);
    preloadLog('当前章节:', status.currentChapter);
    console.groupEnd();
}