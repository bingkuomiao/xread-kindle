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

// v117: 记住策略改为「只记用户名，不记密码」——登录成功后仅把用户名存本机 localStorage，
// 刷新页面后自动回填用户名；密码每次手输（明文存本机有安全风险，改为不存）。
// 同时主动清除 v115/v116 可能遗留的明文密码 key，升级后不再残留历史密码。
// 注销时按约定不清用户名（刷新后仍在）。老 WebKit 在隐私/受限环境访问 localStorage
// 可能抛异常，因此每处访问都 try-catch 包裹，失败静默降级、绝不中断登录。
var LS_LOGIN_USERNAME = "xread_saved_username";
var LS_LOGIN_PASSWORD = "xread_saved_password"; // v117: 保留常量仅用于清除历史遗留密码，不再写入

function saveLoginCredentials() {
    if (config.username) {
        try { window.localStorage.setItem(LS_LOGIN_USERNAME, config.username); } catch (e) { /* localStorage 不可用，静默跳过 */ }
    }
    // v117: 不存密码，并清掉旧版本可能遗留的明文密码
    try { window.localStorage.removeItem(LS_LOGIN_PASSWORD); } catch (e) { /* 静默跳过 */ }
}

function restoreLoginCredentials() {
    var uEl = document.getElementById("username");
    var pEl = document.getElementById("password");
    var u = null;
    try { u = window.localStorage.getItem(LS_LOGIN_USERNAME); } catch (e) { u = null; }
    // v117: 不再回填密码，并清掉旧版本遗留的明文密码
    try { window.localStorage.removeItem(LS_LOGIN_PASSWORD); } catch (e) { /* 静默跳过 */ }
    if (uEl && u) uEl.value = u;
    // v117: 密码框强制留空，确保刷新后每次手输
    if (pEl) pEl.value = "";
}

// ===== v121: 登录占位文字覆盖层（仅 Kindle 端） =====
// KPW3 老 WebKit 对 input 内部占位文字的垂直绘制位置 CSS 不可控
// (v117 行高/v118 伪元素行高/v120 padding 三次真机均无效)，改用普通 span
// 覆盖层接管：普通元素的 line-height 垂直居中在 KPW3 上已被标题/按钮验证有效。
// PC/手机(html.xread-browser)不初始化，覆盖层被 CSS 强制隐藏，原生占位恢复默认——
// 本方案只影响 Kindle 端。
var loginPhItems = null;

function isXreadBrowser() {
    // index.html 头部 UA 脚本：非 Kindle 环境会给 <html> 加 xread-browser 类
    var cls = "";
    try { cls = document.documentElement.className || ""; } catch (e) { cls = ""; }
    return cls.indexOf("xread-browser") !== -1;
}

function syncLoginPlaceholder() {
    if (!loginPhItems) return;
    for (var i = 0; i < loginPhItems.length; i++) {
        var item = loginPhItems[i];
        if (!item.input || !item.ph) continue;
        var cv = vkGetValue(item.input);          // v127: 用缓存值判断，避免缓存期间占位显隐错
        // v134: 只在显隐状态真正变化时写 className，杜绝每次按键都触发样式重算/重绘
        var want = (cv && cv.length > 0) ? "login-ph" : "login-ph on";
        if (item.ph.className !== want) item.ph.className = want;
    }
}

function initLoginPlaceholder() {
    // 只在 Kindle 端启用；PC/手机继续用浏览器原生占位
    if (isXreadBrowser()) return;
    loginPhItems = [
        { input: document.getElementById("username"), ph: document.getElementById("phUsername") },
        { input: document.getElementById("password"), ph: document.getElementById("phPassword") }
    ];
    for (var i = 0; i < loginPhItems.length; i++) {
        var item = loginPhItems[i];
        if (!item.input || !item.ph) continue;
        // 多事件兜底绑定：老 WebKit 对 input 事件的支持不确定，keyup/change 补齐
        item.input.oninput = syncLoginPlaceholder;
        item.input.onkeyup = syncLoginPlaceholder;
        item.input.onchange = syncLoginPlaceholder;
        // v123: 点击覆盖层直接打开虚拟键盘（不再 focus 输入框——聚焦会弹出系统键盘
        // 并触发 Kindle 浏览器强制视口放大，见下方虚拟键盘说明）
        item.ph.onclick = (function (inp) {
            return function () { openVirtualKeyboard(inp); };
        })(item.input);
    }
    syncLoginPlaceholder();
    // 回填/自动填充可能晚于初始化，延时再校正一次
    setTimeout(syncLoginPlaceholder, 500);
}

// ===== v123: 登录页虚拟键盘（仅 Kindle 端） =====
// 真机录屏证实：KPW3 浏览器在系统软键盘弹出时强制放大视口（页面变大、内容溢出
// 屏幕且不可恢复），输入框字号/行高/padding 均无法阻止——这是键盘弹出的伴生行为。
// 方案：登录输入框设 readonly——不弹出系统键盘；输入改由页面内自绘的
// 虚拟键盘面板完成（纯 ES5/DOM）。
// PC/手机(html.xread-browser)不初始化：输入框保持原生可编辑，行为完全不变。

var vkPanelEl = null;
var vkTargetInput = null;
var vkShifted = false;
var vkNumeric = false;
// v127: 输入镜像层（文本 span + 行内光标），靠自然排版紧跟字符，不再测量宽度
var vkMirrorItems = null;
// v127: 输入缓存——按键先写缓存+镜像，不碰真实 input.value；防抖后一次性落盘，
//       根治「写 value 触发重绘期间又来点击」导致的 KPW3 页面放大。
var vkPending = { username: null, password: null };
var vkFlushTimer = null;
var VK_FLUSH_DELAY = 250;
// v135: 显示提速——按键后非显示杂务延后一个 tick，让按键同步栈尽早返回
var vkDeferTimer = null;
// v134: 密码明文显示窗口——输入后明文显示2秒再变圆点，
//       每次按键都重绘圆点的同时让用户看清输入；纯显示层，不影响缓存/提交取值。
var vkRevealPwUntil = 0;        // 密码明文显示截止时间戳(ms)；0=不显示明文
var vkRevealPwTimer = null;     // 到点重绘为圆点的定时器
var VK_REVEAL_MS = 2000;

// v127: 取输入框的"当前值"——缓存优先(有未落盘编辑)，否则真实 value
function vkGetValue(input) {
    if (!input) return "";
    var key = (input.id === "password") ? "password" : "username";
    if (vkPending[key] !== null) return vkPending[key];
    return input.value || "";
}

// v127: 密码掩码——镜像层显示与真实 password input 一致的圆点
function vkDisplayText(input, v) {
    if (input.type === "password") {
        // v136: 明文窗口内只显示"当前输入的最后一位"，前面全部圆点(●●●4)——
        //       让用户看清刚敲的那位，又不暴露整段密码；窗口外全部圆点。
        //       纯显示层——缓存/提交取值始终是明文，不受影响。
        var revealLast = !!(vkRevealPwUntil && (new Date()).getTime() < vkRevealPwUntil);
        var out = "";
        for (var i = 0; i < v.length; i++) {
            if (revealLast && i === v.length - 1) out += v.charAt(i);
            else out += "\u25cf";
        }
        return out;
    }
    return v;
}

// v127: 找到输入框对应的镜像项
function vkMirrorItem(input) {
    if (!vkMirrorItems || !input) return null;
    for (var i = 0; i < vkMirrorItems.length; i++) {
        if (vkMirrorItems[i].input === input) return vkMirrorItems[i];
    }
    return null;
}

// v127: 重绘镜像层——文本用 createTextNode 注入(纯文本，杜绝 HTML 注入)，
//       光标是紧跟文本的 inline span，浏览器自然排版，无需测量宽度。
function vkRenderMirror(input) {
    var item = vkMirrorItem(input);
    if (!item || !item.text) return;
    var v = vkGetValue(input);
    var disp = vkDisplayText(input, v);
    // v134 根治放大：增量更新——只改现有文本节点的 nodeValue，不再 innerHTML="" 销毁重建。
    // 连点/连删每次走这里，销毁重建会在 KPW3 E-ink 上堆积局部重绘→布局错乱(表现为放大)。
    var node = item.text.firstChild;
    if (node && node.nodeType === 3) {
        if (node.nodeValue !== disp) node.nodeValue = disp;
    } else {
        // 首次尚无文本节点时才创建一次（之后一直复用）
        item.text.innerHTML = "";
        item.text.appendChild(document.createTextNode(disp));
    }
}

// v127: 立即把缓存写回真实 input.value(一次 DOM 写入)，并清 timer
function vkFlushInput(input) {
    if (!input) return;
    var key = (input.id === "password") ? "password" : "username";
    if (vkPending[key] === null) return;
    input.value = vkPending[key];
    vkPending[key] = null;
}

// v127: 立即落盘全部缓存（提交/收起/切换输入框前调用）
function vkFlushAll() {
    if (vkFlushTimer) { clearTimeout(vkFlushTimer); vkFlushTimer = null; }
    for (var i = 0; i < (vkMirrorItems ? vkMirrorItems.length : 0); i++) {
        vkFlushInput(vkMirrorItems[i].input);
    }
}

// v127: 防抖落盘——停止输入 VK_FLUSH_DELAY 后才写一次真实 value
function vkScheduleFlush() {
    if (vkFlushTimer) clearTimeout(vkFlushTimer);
    vkFlushTimer = setTimeout(function () {
        vkFlushTimer = null;
        if (vkTargetInput) vkFlushInput(vkTargetInput);
    }, VK_FLUSH_DELAY);
}

// v127: 设置当前输入框的文本到缓存 + 镜像，不写真实 value
// v135 显示提速：显示(nodeValue 赋值)排到同步栈最前，密码 timer / placeholder /
//       flush 调度等非显示杂务延后一个 tick，缩短 touchstart 同步占用，让字符尽快显示。
function vkSetValue(input, v) {
    if (!input) return;
    var key = (input.id === "password") ? "password" : "username";
    vkPending[key] = v;
    // v135: 明文截止时间同步更新——vkRenderMirror 里的 vkDisplayText 需要它立即判定明文/圆点
    if (key === "password") vkRevealPwUntil = (new Date()).getTime() + VK_REVEAL_MS;
    // v135: 显示优先——最高优先级同步落地，连点/连删的字符第一时间显示
    vkRenderMirror(input);
    // v135: 非显示杂务延后一个 tick；连续按键时 clearTimeout 合并为一次，减少抖动
    if (vkDeferTimer) clearTimeout(vkDeferTimer);
    vkDeferTimer = setTimeout(function () {
        vkDeferTimer = null;
        if (key === "password") {
            if (vkRevealPwTimer) clearTimeout(vkRevealPwTimer);
            vkRevealPwTimer = setTimeout(function () {
                vkRevealPwTimer = null;
                vkRevealPwUntil = 0;
                var pw = document.getElementById("password");
                if (pw) vkRenderMirror(pw);   // 增量重绘：明文→圆点，不销毁节点
            }, VK_REVEAL_MS);
        }
        syncLoginPlaceholder();
        vkScheduleFlush();
    }, 0);
}

function vkInsertText(ch) {
    if (!vkTargetInput) return;
    vkSetValue(vkTargetInput, vkGetValue(vkTargetInput) + ch);
}

function vkBackspace() {
    if (!vkTargetInput) return;
    var v = vkGetValue(vkTargetInput);
    if (v.length > 0) vkSetValue(vkTargetInput, v.substring(0, v.length - 1));
}

function vkClearActiveMark() {
    if (!vkTargetInput) return;
    vkTargetInput.className = vkTargetInput.className.replace(" vk-input-active", "");
    vkTargetInput = null;
}

function openVirtualKeyboard(input) {
    if (!vkPanelEl || !input) return;
    if (vkTargetInput !== input) {
        // v127: 切换前先把上一个输入框的缓存落盘，避免丢失
        if (vkTargetInput) {
            vkFlushInput(vkTargetInput);
            vkTargetInput.className = vkTargetInput.className.replace(" vk-input-active", "");
            var oldItem = vkMirrorItem(vkTargetInput);
            if (oldItem && oldItem.mirror) oldItem.mirror.className = "input-mirror";
            vkTargetInput.className = vkTargetInput.className.replace(" vk-mirror-on", "");
        }
        vkTargetInput = input;
        if (vkTargetInput.className.indexOf("vk-input-active") === -1) {
            vkTargetInput.className += " vk-input-active";
        }
        // v127: 当前输入框文字透明，由镜像层显示；镜像层与光标一起显示
        if (vkTargetInput.className.indexOf("vk-mirror-on") === -1) {
            vkTargetInput.className += " vk-mirror-on";
        }
        var item = vkMirrorItem(input);
        if (item && item.mirror) item.mirror.className = "input-mirror on";
        vkRenderMirror(input);
    }
    if (vkPanelEl.className.indexOf(" on") === -1) vkPanelEl.className += " on";
    syncLoginPlaceholder();
}

function closeVirtualKeyboard() {
    if (vkFlushTimer) { clearTimeout(vkFlushTimer); vkFlushTimer = null; }
    // v135: 收起即清未执行的显示杂务，避免关闭后 timer 再触发
    if (vkDeferTimer) { clearTimeout(vkDeferTimer); vkDeferTimer = null; }
    // v134: 收起键盘立即结束密码明文窗口，避免残留定时器与明文显示
    if (vkRevealPwTimer) { clearTimeout(vkRevealPwTimer); vkRevealPwTimer = null; }
    vkRevealPwUntil = 0;
    if (vkTargetInput) {
        vkFlushInput(vkTargetInput);   // 收起即落盘，保证提交读到最新值
        vkTargetInput.className = vkTargetInput.className.replace(" vk-input-active", "");
        vkTargetInput.className = vkTargetInput.className.replace(" vk-mirror-on", "");
        var item = vkMirrorItem(vkTargetInput);
        if (item && item.mirror) item.mirror.className = "input-mirror";
    }
    vkTargetInput = null;
    if (vkPanelEl) {
        var cls = "vk-panel" + (vkNumeric ? " num" : "");
        vkPanelEl.className = cls;
    }
}

function vkSetShift(on) {
    vkShifted = on;
    if (!vkPanelEl) return;
    if (on && vkPanelEl.className.indexOf(" shifted") === -1) vkPanelEl.className += " shifted";
    if (!on) vkPanelEl.className = vkPanelEl.className.replace(" shifted", "");
}

function vkSetPage(numeric) {
    vkNumeric = numeric;
    if (vkPanelEl) {
        if (numeric && vkPanelEl.className.indexOf(" num") === -1) vkPanelEl.className += " num";
        if (!numeric) vkPanelEl.className = vkPanelEl.className.replace(" num", "");
    }
    vkSetShift(false);
}

function vkKeyBtns(list, kind) {
    var arr = list.split(" ");
    var out = "";
    for (var i = 0; i < arr.length; i++) {
        out += '<div class="vk-key vk-k-' + kind + '" data-vk="ch" data-ch="' + arr[i] + '">' + arr[i] + "</div>";
    }
    return out;
}

function buildVirtualKeyboard() {
    if (vkPanelEl) return;
    var panel = document.createElement("div");
    panel.className = "vk-panel";
    var html = "";
    // v128: 删除顶部公共数字行（按用户要求）；数字已移入 123 数字符号页，切页即可输入
    // —— 字母页 ——
    html += '<div class="vk-page vk-page-abc">';
    html += '<div class="vk-row">' + vkKeyBtns("q w e r t y u i o p", "letter") + "</div>";
    html += '<div class="vk-row">' + vkKeyBtns("a s d f g h j k l", "letter") + "</div>";
    html += '<div class="vk-row"><div class="vk-key vk-key-fn" data-vk="shift">\u21e7</div>'
        + vkKeyBtns("z x c v b n m", "letter")
        + '<div class="vk-key vk-key-fn vk-key-del" data-vk="del">\u5220\u9664</div></div>';
    // v128: 空格键缩短、登录键加长居中、删除键在上一行加长（防误触面积保留）
    html += '<div class="vk-row">'
        + '<div class="vk-key vk-key-fn" data-vk="num123">123</div>'
        + '<div class="vk-key vk-key-narrow" data-vk="ch" data-ch="@">@</div>'
        + '<div class="vk-key vk-key-narrow" data-vk="ch" data-ch=".">.</div>'
        + '<div class="vk-key vk-key-fn vk-key-space" data-vk="space">&nbsp;</div>'
        + '<div class="vk-key vk-key-fn vk-key-login" data-vk="submit">\u767b\u5f55</div>'
        + '<div class="vk-key vk-key-fn" data-vk="close">\u6536\u8d77</div>'
        + "</div></div>";
    // —— 数字符号页 ——（v128: 数字 1-0 已移回本页首行，点 123 切页即可输入纯数字密码）
    html += '<div class="vk-page vk-page-num">';
    html += '<div class="vk-row">' + vkKeyBtns("1 2 3 4 5 6 7 8 9 0", "digit") + "</div>";
    html += '<div class="vk-row">' + vkKeyBtns("@ . - _ # + /", "sym") + "</div>";
    html += '<div class="vk-row">'
        + '<div class="vk-key vk-key-fn" data-vk="space">&nbsp;</div>'
        + vkKeyBtns("( ) ! ? : ;", "sym")
        + '<div class="vk-key vk-key-fn vk-key-del" data-vk="del">\u5220\u9664</div>'
        + "</div>";
    // v129: 数字页两键换位——收起键在中间且缩短(20%)，登录键在末尾占满剩余(长)
    html += '<div class="vk-row">'
        + '<div class="vk-key vk-key-fn vk-key-space" data-vk="abc">ABC</div>'
        + '<div class="vk-key vk-key-fn" data-vk="close">\u6536\u8d77</div>'
        + '<div class="vk-key vk-key-fn" data-vk="submit">\u767b\u5f55</div>'
        + "</div></div>";
    panel.innerHTML = html;
    document.body.appendChild(panel);
    vkPanelEl = panel;
    // v127: 初始化镜像项（文本 span + 光标 span），Kindle 端 input 文字由镜像接管
    vkMirrorItems = [
        { input: document.getElementById("username"), mirror: document.getElementById("mirrorUsername"), text: null },
        { input: document.getElementById("password"), mirror: document.getElementById("mirrorPassword"), text: null }
    ];
    for (var mi = 0; mi < vkMirrorItems.length; mi++) {
        var mit = vkMirrorItems[mi];
        if (mit.mirror) mit.text = mit.mirror.getElementsByTagName("span")[0];
    }
    // 按键事件委托：统一处理面板内所有按键（老 WebKit addEventListener 支持）
    panel.addEventListener("click", vkHandleKey);
}

function vkHandleKey(e) {
    var t = e.target || e.srcElement;
    if (!t || t.nodeType !== 1) return;
    var act = t.getAttribute("data-vk");
    if (!act) return;
    if (act === "ch") {
        var ch = t.getAttribute("data-ch") || "";
        if (vkShifted && t.className.indexOf("vk-k-letter") !== -1) {
            ch = ch.toUpperCase();
            vkSetShift(false);   // 一次大写后自动回落小写
        }
        vkInsertText(ch);
    } else if (act === "del") {
        vkBackspace();
    } else if (act === "space") {
        vkInsertText(" ");
    } else if (act === "shift") {
        vkSetShift(!vkShifted);
    } else if (act === "num123") {
        vkSetPage(true);
    } else if (act === "abc") {
        vkSetPage(false);
    } else if (act === "close") {
        closeVirtualKeyboard();
    } else if (act === "submit") {
        closeVirtualKeyboard();
        var btn = document.getElementById("loginSubmit");
        if (btn) btn.click();
    }
}


function initLoginVirtualKeyboard() {
    // 只在 Kindle 端启用；PC/手机输入框保持原生可编辑
    if (isXreadBrowser()) return;
    var inputs = [document.getElementById("username"), document.getElementById("password")];
    var found = 0;
    var i;
    for (i = 0; i < inputs.length; i++) {
        if (!inputs[i]) continue;
        inputs[i].readOnly = true;   // readonly 聚焦不弹系统键盘
        found++;
    }
    if (!found) return;
    buildVirtualKeyboard();
    for (i = 0; i < inputs.length; i++) {
        if (!inputs[i]) continue;
        inputs[i].addEventListener("click", function () { openVirtualKeyboard(this); });
    }
    // v124: 点击输入框与虚拟键盘以外区域时收起键盘——事件冒泡到 document 统一判定，
    // 面板内部、两个输入框、占位覆盖层(login-ph)都算"键盘相关区域"不收起。
    document.addEventListener("click", function (e) {
        if (!vkPanelEl) return;
        if (vkPanelEl.className.indexOf(" on") === -1) return;
        var t = e.target || e.srcElement;
        while (t && t.nodeType === 1) {
            if (t === vkPanelEl) return;
            if (t.id === "username" || t.id === "password") return;
            var c = t.className || "";
            if (c.indexOf && c.indexOf("login-ph") !== -1) return;
            t = t.parentNode;
        }
        closeVirtualKeyboard();
    });
}

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
    preloadStepTimer = null,             // v116: 预加载分批的单步定时器句柄（用于取消旧链）
    preloadGeneration = 0,               // v116: 预加载代数令牌（章节切换递增，使旧链失效）
    lastPageTurnDirection = 0,           // 0=管理, 1=向下翻页, -1=向上翻页
    enablePreload = true;                // 是否启用预加载
// 在性能优化配置部分添加滚动计数变量
var lazyCoversCount = 12,                // 每批加载封面数（走后端代理+缓存后可适度加大，加快铺满）
    lazyLoadedCovers = {},
    lazyLoadInitialized = false,
    lazyScrollCount = 0,                 // 滚动次数计数
    lazyScrollThreshold = 1;             // 滚动阈值：滚动1次即补加载，避免封面迟迟不出现
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
    preloadStepTimer = null;             // v116: 重置单步定时器
    preloadGeneration++;                 // v116: 换书时递增代数，作废任何在飞的旧预加载链
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
    // 性能优化：所有书源封面统一走后端 /reader3/cover 代理。
    // 后端按图片URL的md5做磁盘缓存(带防盗链Referer绕过) + 浏览器缓存86400s，
    // 避免 Kindle 弱网直连外部图床导致加载慢/防盗链失败。与 Vue3 端 getCoverUrl 行为一致。
    var coverUrl = book.coverUrl;
    if (book.customCoverUrl) {
        coverUrl = book.customCoverUrl;
    }

    if (!coverUrl) {
        coverUrl = "img/noCover.jpg";
    } else {
        // 已经是代理地址（含完整URL形式）则直接补全/使用，避免二次编码；
        // 否则无论是外链还是相对路径，都包一层代理
        var proxyTag = "/reader3/cover?path=";
        var tagPos = coverUrl.indexOf(proxyTag);
        if (tagPos === 0) {
            coverUrl = apiBase() + coverUrl;
        } else if (tagPos > 0 && coverUrl.indexOf('http') === 0) {
            // 完整 URL 的代理地址，已带绝对地址，直接使用
        } else {
            coverUrl = apiBase() + proxyTag + encodeURIComponent(coverUrl);
        }
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

// 视口检查：矩形相交即可（放宽判定，让首屏封面尽早加载）。
// 只读 el 的位置，不写 DOM —— 供 checkVisibleCovers 的“纯读阶段”批量调用。
function isElementInViewportKindle(el) {
    if (!el || typeof el.getBoundingClientRect !== 'function') {
        return false;
    }
    try {
        var rect = el.getBoundingClientRect();
        // 视口上下边界；向下多留半屏作为预取缓冲，向上留 1 屏避免回滑空白
        var vh = window.innerHeight || document.documentElement.clientHeight;
        var topLimit = -vh;
        var bottomLimit = vh * 1.5;
        // 只要元素与扩展视口有交集就加载（不再要求四边全部落在视口内）
        return rect.bottom >= topLimit && rect.top <= bottomLimit;
    } catch (e) {
        console.error('视口检查错误:', e);
        return true; // 出错时默认加载
    }
}

// 检查可见封面。性能优化（读写分离）：
// 老 Kindle WebKit 上，“读 getBoundingClientRect → 写 classList”交替会触发强制同步重排，
// 滑动时表现为卡顿。这里拆成两阶段：阶段1纯读收集候选，阶段2纯写统一加载，杜绝读写交替。
function checkVisibleCovers() {
    // v109优化: 限定在 #bookList 内查询，避免全文档扫描；老 WebKit 的复杂 :not() 选择器在大 DOM 上有成本。
    var coverScope = $("#bookList");
    var lazyCovers = coverScope ? coverScope.querySelectorAll('.lazy-cover:not(.cover-loaded):not(.cover-error):not(.cover-loading)') : document.querySelectorAll('.lazy-cover:not(.cover-loaded):not(.cover-error):not(.cover-loading)');
    if (!lazyCovers.length) return;
    preloadLog('找到 ' + lazyCovers.length + ' 个待加载封面，滚动计数: ' + lazyScrollCount);

    // ===== 阶段1：纯读，收集可见封面（此阶段不写任何 DOM / class）=====
    var visibleImgs = [];
    var invalidImgs = [];
    for (var i = 0; i < lazyCovers.length; i++) {
        var img = lazyCovers[i];
        var dataSrc = img.getAttribute('data-src');
        if (!dataSrc || !img.parentNode) {
            invalidImgs.push(img);
            continue;
        }
        if (isElementInViewportKindle(img)) {
            visibleImgs.push(img);
        }
    }

    // ===== 阶段2：纯写，统一处理（标记错误 + 触发加载）=====
    var loadedCount = 0;
    for (var m = 0; m < invalidImgs.length; m++) {
        invalidImgs[m].classList.add('cover-error');
    }
    for (var n = 0; n < visibleImgs.length && loadedCount < lazyCoversCount; n++) {
        loadCoverImage(visibleImgs[n], 0);
        loadedCount++;
    }

    // 视口内不足且达到滚动阈值时，按文档顺序补足剩余名额（同样在纯写阶段）
    var remainingSlots = lazyCoversCount - loadedCount;
    if (remainingSlots > 0 && shouldForceLoadCovers()) {
        preloadLog('视口加载 ' + loadedCount + ' 张，剩余 ' + remainingSlots + ' 个位置，强制补足');
        for (var j = 0; j < lazyCovers.length && loadedCount < lazyCoversCount; j++) {
            var forceImg = lazyCovers[j];
            if (forceImg.classList.contains('cover-loading') ||
                forceImg.classList.contains('cover-loaded') ||
                forceImg.classList.contains('cover-error')) {
                continue;
            }
            loadCoverImage(forceImg, 0);
            loadedCount++;
        }
    }

    if (loadedCount > 0) {
        preloadLog('本次总共加载了 ' + loadedCount + ' 张封面');
    }
}

// 图片加载函数。性能优化：直接用目标 img 元素加载，去掉 new Image() 二次预加载，
// 减少一层对象创建与 onload 转手赋值；配合 checkVisibleCovers 的读写分离，滑动更跟手。
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

    // 已在加载中/已加载/已失败：跳过，避免重复加载
    if (img.classList.contains('cover-loading') ||
        img.classList.contains('cover-loaded') ||
        img.classList.contains('cover-error')) {
        return;
    }

    // 一次书架会话内已成功加载过的相同URL，直接复用（HTTP 缓存命中，瞬时显示）
    if (lazyLoadedCovers[dataSrc]) {
        img.src = dataSrc;
        img.classList.remove('lazy-cover');
        img.classList.add('cover-loaded');
        img.removeAttribute('data-src');
        return;
    }

    preloadLog('开始加载封面: ' + dataSrc + (retryCount > 0 ? ' (重试 ' + retryCount + ')' : ''));
    // 标记为加载中（写在纯写阶段，不与 getBoundingClientRect 交替）
    img.classList.add('cover-loading');

    img.onerror = function() {
        img.onerror = null;
        img.onload = null;
        img.classList.remove('cover-loading');
        if (retryCount < 1) {
            preloadLog('封面加载失败，准备重试: ' + dataSrc);
            setTimeout(function() {
                if (img.parentNode) {
                    loadCoverImage(img, retryCount + 1);
                }
            }, 500);
        } else {
            preloadLog('封面加载最终失败，使用默认图片: ' + dataSrc);
            img.onerror = null;
            img.src = "img/noCover.jpg";
            img.classList.remove('lazy-cover');
            img.classList.add('cover-error');
            img.removeAttribute('data-src');
        }
    };

    img.onload = function() {
        img.onerror = null;
        img.onload = null;
        // WebKit534 的 DOMTokenList.remove 只处理第一个参数，拆成两次单参数调用
        img.classList.remove('lazy-cover');
        img.classList.remove('cover-loading');
        img.classList.add('cover-loaded');
        img.removeAttribute('data-src');
        lazyLoadedCovers[dataSrc] = true;
        preloadLog('封面加载成功: ' + dataSrc);
    };

    // 直接加载：浏览器原生加载 + HTTP 缓存（后端 Cache-Control 86400）
    img.src = dataSrc;
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
        // v116: 章节跳转优先——立即递增代作废旧预加载链，清掉其单步定时器与 loading 残留。
        // 这样目录打开时启动的批量缓存会停下，不再抢占跳转请求的带宽与 CPU。
        preloadGeneration++;
        if (preloadTimer) { clearTimeout(preloadTimer); preloadTimer = null; }
        if (preloadStepTimer) { clearTimeout(preloadStepTimer); preloadStepTimer = null; }
        for (var _pk in preloadedChaptersMapCache) {
            if (preloadedChaptersMapCache[_pk] === 'loading') delete preloadedChaptersMapCache[_pk];
        }
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
    // v109修复: 原 else-if(>3倍) 被前置 if(>2倍) 拦截成死代码，调换顺序让严重超限的强制清理能真正执行。
    if (cacheSize > preloadCount * 3) {
        preloadLog("缓存数量(" + cacheSize + ")严重超过阈值，强制清理");
        // 紧急情况下的强制清理
        for (var index in preloadedChaptersMapCache) {
            var chapterIndex = parseInt(index);
            if (Math.abs(chapterIndex - currentChapterIndex) > preloadCount * 2) {
                delete preloadedChaptersMapCache[chapterIndex];
            }
        }
    } else if (cacheSize > preloadCount * 2) {
        preloadLog("缓存数量(" + cacheSize + ")超过阈值，触发智能清理");
        smartClearPreloadCache();
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

    // v114 修复（进书跳回第一章根因）：
    // 原实现这里传的是「尚未更新的」currentChapterIndex：
    //  - 翻章时它是旧章号，恰好让 getBookContentPage 走章内翻页分支，用已分页的 pageList 渲染，看似正常；
    //  - 但进书/返回书架后 freshBookCache 把 currentChapterIndex 置为 null，
    //    getBookContentPage 入口 parseInt(null)=NaN 被归一化成 0，误判为「换章」而异步去请求第一章，
    //    返回后覆盖 pageList，表现为「从已读章节跳回最开始章节」（进度其实已正确保存）。
    // 修复：先把 targetChapterIndex 归一化并提前写入 currentChapterIndex，
    //       使下面的 getBookContentPage 必走章内翻页分支、直接渲染已分页好的 pageList，杜绝多余的第一章请求；
    //       同时保留旧章号 prevChapterIndex 供下方相邻章缓存判断，语义与原实现一致。
    var normalizedTarget = parseInt(targetChapterIndex, 10);
    if (isNaN(normalizedTarget)) normalizedTarget = 0;
    var prevChapterIndex = currentChapterIndex;
    
    disposeBookContent(normalizedTarget, bookStr);
    currentChapterIndex = normalizedTarget;
    getBookContentPage(currentChapterIndex, bookUrl, 1, lastPage);
    // 立即保存阅读进度（章节切换）
    saveReadProcess(normalizedTarget, bookUrl, true);
    
    // 更新章节缓存（用旧章号判断翻章方向，语义与原实现一致）
    if (normalizedTarget == prevChapterIndex - 1) {
        nextChapterContent = currentChapterContent;
        preChapterContent = null;
    } else if (normalizedTarget == prevChapterIndex + 1) {
        preChapterContent = currentChapterContent;
        nextChapterContent = null;
    }
    
    currentChapterContent = bookStr;
    
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
    
    // v116: 递增代数——本次启动成为最新一代；任何旧链的异步回调持有旧 gen，会被校验拦截。
    // 同时清掉旧链的调度定时器与新链自己的单步定时器，避免残留 trigger。
    preloadGeneration++;
    var myGen = preloadGeneration;
    if (preloadTimer) {
        clearTimeout(preloadTimer);
    }
    if (preloadStepTimer) {
        clearTimeout(preloadStepTimer);
        preloadStepTimer = null;
    }
    
    // 延迟执行，避免影响当前操作
    preloadTimer = setTimeout(function() {
        // v116: 若等待期间代数已变（发生了章节跳转），放弃本次调度
        if (myGen !== preloadGeneration) return;
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
        preloadChaptersBatch(chaptersToPreload, 0, myGen);
        }
    }, 100);
}

// 分批预加载章节（内部实现）
// v116: 增加 gen 参数——每一步、每个回调都校验代数，代数过期则整条旧链立即停止，
//       不再发新请求、不再写缓存、不再递归下一步，让章节跳转能抢占资源。
function preloadChaptersBatch(chapters, index, gen) {
    if (index >= chapters.length) return;
    if (gen !== preloadGeneration) return;  // v116: 代数过期，旧链终止
    
    var chapterIndex = chapters[index];
    
    // 再次检查是否已预加载（防止重复）
    if (preloadedChaptersMapCache[chapterIndex]) {
        preloadLog("章节 " + chapterIndex + " 已在缓存中，跳过预加载");
        preloadChaptersBatch(chapters, index + 1, gen);
        return;
    }
    // 标记为预加载中
    preloadedChaptersMapCache[chapterIndex] = 'loading';
    
    var params = buildBookContentParams(chapterIndex, currentBookUrl);
    
    // 延迟加载，避免同时发起太多请求
    preloadStepTimer = setTimeout(function() {
        // v116: 定时器触发时再校验一次（等待期间可能已发生跳转）
        if (gen !== preloadGeneration) {
            // 清掉本步遗留的 loading 标记，避免该章节永远卡在"加载中"而无法再缓存
            if (preloadedChaptersMapCache[chapterIndex] === 'loading') delete preloadedChaptersMapCache[chapterIndex];
            return;
        }
        if (config.type == "app") {
            HttpGet(url(bookContent, params), function(res) {
                // v116: 响应回来再校验，防止用旧章节结果污染缓存
                if (gen !== preloadGeneration) return;
                handlePreloadResponse(res, chapterIndex, currentBookUrl);
                preloadChaptersBatch(chapters, index + 1, gen);
            });
        } else {
            HttpPost(url(bookContent), params, function(res) {
                if (gen !== preloadGeneration) return;
                handlePreloadResponse(res, chapterIndex, currentBookUrl);
                preloadChaptersBatch(chapters, index + 1, gen);
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

// ========== v130: 漫画图片代理 + 相邻预取（KPW3 / WebKit 534 / ES5）==========
// 老 WebKit 正则无 lookbehind，用 (^|\s) 捕获组定位 src，避免误匹配 data-src。
function comicMatchSrc(tag) {
    return tag.match(/(^|\s)(src\s*=\s*)(["']?)([^"'\s>]+)\3/);
}

// 把单张图片 URL 包一层后端代理：data: 内联图 / 相对本地图 / 已代理地址均原样返回。
function comicProxySrc(rawUrl) {
    if (!rawUrl) return rawUrl;
    var u = String(rawUrl).replace(/^\s+|\s+$/g, "");
    if (/^data:/i.test(u)) return rawUrl;
    if (u.indexOf("/reader3/cover?path=") >= 0) return rawUrl;
    if (!/^https?:\/\//i.test(u)) return rawUrl;
    u = u.replace(/&amp;/gi, "&");
    return apiBase() + "/reader3/cover?path=" + encodeURIComponent(u);
}

// 重写 <img> 标签的 src 为代理地址，保留其余属性与原引号风格。
function comicProxyImgTag(tag) {
    var m = comicMatchSrc(tag);
    if (!m || !m[4]) return tag;
    var proxied = comicProxySrc(m[4]);
    if (proxied === m[4]) return tag;
    var idx = tag.indexOf(m[0]);
    if (idx < 0) return tag;
    var rebuilt = m[1] + m[2] + m[3] + proxied + m[3];
    return tag.slice(0, idx) + rebuilt + tag.slice(idx + m[0].length);
}

// 预取当前页前1后2张图到浏览器缓存：只发请求、不插 DOM、不占布局。
// 小对象池持有 Image 引用，避免老内核 GC 取消在飞请求；池上限防长会话内存膨胀。
// v132: 预取代次令牌——翻页时递增，旧页的延迟预取回调据此判废
var comicPreloadGen = 0;
var comicPreloadPool = [];
function comicPreloadNeighbors(pages, pageIndex) {
    if (!pages || !pages.length) return;
    var offsets = [-1, 1, 2];
    for (var i = 0; i < offsets.length; i++) {
        var idx = pageIndex + offsets[i];
        if (idx < 0 || idx >= pages.length) continue;
        var m = comicMatchSrc(pages[idx]);
        if (!m || !m[4]) continue;
        var pre = new Image();
        pre.src = comicProxySrc(m[4]);
        comicPreloadPool.push(pre);
    }
    if (comicPreloadPool.length > 24) {
        comicPreloadPool = comicPreloadPool.slice(-12);
    }
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
        // v130: 每张图 src 包一层后端 /reader3/cover 代理（与书架封面同款）：
        // 后端按 URL md5 磁盘缓存 + 绕防盗链 + Cache-Control:86400，
        // 解决 Kindle 弱网直连图床慢 / 防盗链失败；一图一页不变。
        pageList = [];
        for (var ci = 0; ci < imgList.length; ci++) {
            pageList.push(comicProxyImgTag(imgList[ci]));
        }
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
    comicPreloadGen++;  // v132: 每次显示新页使旧页延迟预取回调失效
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
            // v130: 图片加载失败兜底，避免破图（noCover 为本地图，不再递归）
            theImg.onerror = function () {
                this.onerror = null;
                this.src = 'img/noCover.jpg';
            };
        }
        // v132 漫画黑屏修复：v130 进入页时立即并发预取前1后2共3张大图 + 当前页，
        // 4 图同时走后端代理下载，KPW3 弱网下首图被拖慢、E-ink 刷黑时间被拉长。
        // 改为：首图 load/onerror 后再预取相邻图；generation token 防快速翻页竞态；
        // 2.5s 超时兜底（图床无响应时仍预取，避免永久不预热）。
        var v132MyGen = comicPreloadGen;
        var v132PreFired = false;
        function v132Preload() {
            if (v132PreFired) return;
            v132PreFired = true;
            if (v132MyGen === comicPreloadGen && isComicMode) {
                comicPreloadNeighbors(pages, currentBookPage - 1);
            }
        }
        if (theImg && !theImg.complete) {
            theImg.onload = v132Preload;
            setTimeout(v132Preload, 2500);
        } else {
            v132Preload();
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

// v117: 分组下拉会话级缓存——设置弹窗每次打开都发 getBookGroups，弱网时下拉一直卡在
//       「正在读取分组…」。缓存命中即同步填充(秒显)，同时后台静默刷新保证跨设备新增分组能同步。
//       null=尚未成功加载；数组=已加载(含空数组)。页面刷新后变量重置，会重新拉一次最新分组。
var bookGroupsListCache = null;
var bookGroupsReqPending = false; // 有在飞的分组请求时不再重复发，避免并发

// v117: 通用分组读取——force=true 强制走网络(成功仍回写缓存)；callback(groups, ok)
function fetchBookGroups(force, callback) {
    if (!force && bookGroupsListCache !== null) {
        if (callback) callback(bookGroupsListCache, true);
        return;
    }
    if (bookGroupsReqPending) { return; }
    bookGroupsReqPending = true;
    var xhr = new XMLHttpRequest();
    xhr.open("GET", url(getBookGroups), true);
    if (config.type == "multi") { xhr.withCredentials = true; }
    xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) { return; }
        bookGroupsReqPending = false;
        var ok = (xhr.status === 200);
        var groups = [];
        if (ok) {
            var res = null;
            try { res = JSON.parse(xhr.responseText); } catch (e) { res = null; }
            groups = (res && res.data && res.data.length) ? res.data : [];
            bookGroupsListCache = groups; // 仅在成功时回写缓存，失败保留旧值
        }
        if (callback) callback(groups, ok);
    };
    xhr.send();
}

// v117: 填充分组下拉；重填时保留用户当前已选项，避免后台刷新打断操作
function fillGroupSelect(sel, groups) {
    if (!sel) { return; }
    var keep = sel.value;
    sel.options.length = 0;
    sel.options.add(new Option("未分组", "0"));
    for (var i = 0; i < groups.length; i++) {
        var gid = parseInt(groups[i].groupId, 10);
        if (isNaN(gid)) { gid = 0; }
        sel.options.add(new Option(groups[i].groupName || ("分组" + gid), String(gid)));
    }
    if (keep) {
        for (var j = 0; j < sel.options.length; j++) {
            if (sel.options[j].value === keep) { sel.value = keep; break; }
        }
    }
}

// 移动书籍：读取已有分组填入下拉框（v117: 缓存秒显 + 后台静默刷新）
function mgmtLoadGroups() {
    var sel = document.getElementById("mgmtGroupSelect");
    if (!sel) { return; }
    var useCache = (bookGroupsListCache !== null);
    if (useCache) {
        // 命中缓存：同步填充，秒显，不显示「正在读取」
        fillGroupSelect(sel, bookGroupsListCache);
        bmStatus(bookGroupsListCache.length ? "选择分组后点「移动分组」" : "暂无分组");
    } else {
        bmStatus("正在读取分组…");
    }
    // 首次无缓存：等网络回来再填充；命中缓存：后台静默刷新(不改状态栏、保留已选项)
    fetchBookGroups(false, function (groups, ok) {
        if (!useCache) {
            if (ok) {
                fillGroupSelect(sel, groups);
                bmStatus(groups.length ? "选择分组后点「移动分组」" : "暂无分组");
            } else {
                bmStatus("分组读取失败");
            }
        }
    });
    // 命中缓存时后台刷新一次，跨设备新增的分组下次打开即可见
    if (useCache) {
        setTimeout(function () {
            fetchBookGroups(true, function (groups, ok) {
                if (ok) { fillGroupSelect(sel, groups); }
            });
        }, 0);
    }
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
    // v115: 回填已记住的用户名密码，刷新后无需重输（失败静默降级）
    restoreLoginCredentials();
    // v121: 登录占位文字覆盖层（仅 Kindle 端生效；须在回填之后初始化以同步显隐）
    initLoginPlaceholder();
    // v123: 登录虚拟键盘（仅 Kindle 端；readonly 输入框 + 自绘面板，避免系统键盘放大页面）
    initLoginVirtualKeyboard();
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
        vkFlushAll();  // v127: 提交前把镜像缓存一次性落盘，保证读到最新值
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
                // v115: 记住本次登录的用户名密码（输入框原文），供刷新后回填
                saveLoginCredentials();
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
    // v124: 提交登录先收起虚拟键盘——用户可能直接点表单上的「登录」按钮（不走键盘
    // submit 键），不收起会把键盘带到书架页；登录失败时键盘保持收起，重开一次即可。
    closeVirtualKeyboard();
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
    // v116: 同时取消预加载单步定时器并递增代数，确保退出登录时旧预加载链彻底失效
    if (preloadStepTimer) {
        clearTimeout(preloadStepTimer);
        preloadStepTimer = null;
    }
    preloadGeneration++;
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
    if (coverKeys.length > 60) { // v109修复: 原 > lazyLoadedCovers*10 因对象是NaN永远false，封面缓存无上限；改为固定阈值60
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
        preloadLog("v113: 退出登录前异步保存进度(forceSave=true 兜底，替代原同步XHR，避免弱网冻结主线程)");
        // 用 forceSave=true 保证即使章节未变也发送；url() 在调用瞬间已把 accessToken 拼进 URL，
        // 后续 logout 里 accessToken=null 不影响这条在途请求，无丢进度风险。
        saveReadProcess(currentChapterIndex, currentBookUrl, true);
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
