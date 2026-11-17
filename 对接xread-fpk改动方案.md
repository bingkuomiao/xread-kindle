# xread-kindle 对接 xread-fpk 后端 · 改动方案

> 分析依据：
> - 前端：`xread-kindle`（`index.html` / `js/config.js` / `js/kindle.js`）
> - 后端：`bingkuomiao/xread-fpk`（`main` 分支，commit `9af4149…`），即 `Charmillionaire/xread`（Rust/axum 后端 + Vue3 前端，"阅读3 / reader3" 体系）的自托管 fork，**后端零改动**
> - 后端路由源码：`upstream/src/api/router.rs`、`handlers/{book,book_source,user}.rs`

---

## 0. 结论速览

- xread-fpk 是标准 **reader3** 后端，所有 JSON 接口统一挂在 **`/reader3/`** 前缀下，与 xread-kindle 前端 `url()` 拼接规则（`/reader3/{router}`）**完全一致**。
- xread-kindle 依赖的 **9 个接口中有 6 个可直接复用**，3 个需要调整：
  1. **`getBookContent`**：前端请求字段语义不符（传 `url=bookUrl`，后端期望 `chapterUrl`+`bookSourceUrl`）。
  2. **`searchBookSource`**：后端**无此路由**（只有 SSE 版 `searchBookSourceSSE` 和 `getAvailableBookSource`），且返回结构是 `books/lastIndex/hasMore`。
  3. **`deleteBook`**：后端按 `Book.bookUrl` 删除，前端只传了 `url`，需补 `bookUrl`。
- 推荐 **"前端改动 + 后端零改动"** 方案：仅改 `js/kindle.js` 三处 + `js/config.js` 配置。

---

## 1. 对接方式（部署拓扑）

```
┌──────────────────┐         HTTP /reader3/*          ┌──────────────────────┐
│  xread-kindle     │  ───────────────────────────▶   │  xread-fpk 后端       │
│  (静态站点,       │   accessToken 作为 query 传参     │  Rust/axum, 端口 7777 │
│   Kindle 浏览器)  │  ◀───────────────────────────   │  (fnOS .fpk 部署)     │
└──────────────────┘                                  └──────────────────────┘
```

- xread-fpk **独立部署**（默认端口 `7777`，fnOS 打包为 `.fpk`）。
- xread-kindle 仍是**独立静态站点**，不需要塞进 xread 的 web 目录；只要把 `READER_CONFIG.address` 指向 xread 后端基址即可。
- 二者通过 `accessToken`（query 参数）鉴权，浏览器同源/跨域由 xread 的 `CorsLayer::very_permissive()` 放行。

---

## 2. 接口兼容性矩阵

| kabi 接口常量 | xread 路由 | 方法 | 结论 | 关键差异 |
|---|---|---|---|---|
| `login` | `POST /reader3/login` | POST | ✅ 直接复用 | 请求 `{username,password,isLogin,code}` 一致；返回 `data.accessToken`（阅读3 标准） |
| `logout` | `POST /reader3/logout` | POST | ✅ 直接复用 | 后端返回 `err("请重新登录")` 错误体，kabi 忽略响应，无影响 |
| `getBookshelf` | `GET /reader3/getBookshelf` | GET | ✅ 直接复用 | 返回 legado 标准书本数组，字段与前端读取一致 |
| `getChapterList` | `GET/POST /reader3/getChapterList` | POST | ✅ 直接复用 | `url` 被反序列化为 `book_url`（别名），kabi 传 `url:bookUrl` 正确 |
| `getBookContent` | `GET/POST /reader3/getBookContent` | POST | ⚠️ **需改动** | 见 §3.1 |
| `saveBookProgress` | `POST /reader3/saveBookProgress` | POST | ✅ 直接复用 | 收 `{url\|bookUrl, index}`，kabi 传 `url:bookUrl`/`index` 兼容 |
| `searchBookSource` | （无）/ `getAvailableBookSource` / `searchBookSourceSSE` | GET/POST | ⚠️ **需改动** | 见 §3.2 |
| `setBookSource` | `POST /reader3/setBookSource` | POST | ✅ 直接复用 | 解析 `bookUrl\|url`→book_url、`newUrl`、`bookSourceUrl`，kabi 三参齐全 |
| `deleteBook` | `POST /reader3/deleteBook` | POST | ⚠️ **需补字段** | 收 `Json<Book>`，按 `bookUrl` 删除；kabi 只传 `url` 会导致 `book_url` 为空。需补 `bookUrl` |

### 书本/章节对象字段核对（✅ 一致）
- **书架**：`name, author, bookUrl, origin, coverUrl, customCoverUrl, totalChapterNum, durChapterIndex, durChapterPos, durChapterTime, durChapterTitle, latestChapterTitle, latestChapterTime` —— 与 `createBookItemElement()` 读取字段完全对应。
- **目录**：`{ index, title, url }`，`url` 为**章节内容 URL**，kabi 用 `index/title`，`url` 供正文获取（§3.1 关键）。
- **正文**：返回章节正文**字符串**。
- **封面**：`coverUrl` 相对路径时由 `config.address + coverUrl` 拼接（xread 封面走 `/reader3/cover?path=...`，拼接后可直接访问）。

---

## 3. 必须改的三处（均在 `js/kindle.js`）

### 3.1 `getBookContent` —— 修正请求字段语义

**问题**
- kabi 当前发送：`{ index, refresh:1, url: bookUrl }`，期望返回第 `index` 章正文。
- xread `BookContentRequest` 定义：`chapterUrl`（别名 `url`/`href`）、`bookSourceUrl`（别名 `origin`）、`bookSource`、`index`、`refresh`。**`url` 会被反序列化为 `chapter_url`（章节URL），而非 bookUrl**；且结构体**没有 `bookUrl` 字段**。
- 后端 `resolve_book_source` 需要 `bookSourceUrl`/`bookSource` 或 `book_url`/`toc_url` 才能定位书源；若只传 `url=bookUrl`（被当成 chapterUrl），无法解析到正确书源 → 拿不到正文。

**修复思路**：章节列表返回项已带 `url`（章节内容 URL），改为发送 `chapterUrl` + `bookSourceUrl`。

> ⚠️ 关键细节：后端对 `chapterUrl` 有一个启发式判断——若同时带 `index` 且 URL 不含 `/read/` 或 `/chapter/`，就会被**当成 bookUrl** 去重新解析目录。多数书源的章节 URL 并不含这两个标记，因此正文请求**只传 `chapterUrl`，不传 `index`**；只有拿不到章节 URL 时才回退成 `{url: bookUrl, index}` 走后端的 bookUrl 解析分支。

**改动 —— 新增 `buildBookContentParams()` 并改造 `getBookContent()` / `preloadChaptersBatch()`**
```javascript
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
```
- `getBookContent()` 中 `var params = { index, refresh, url }` 改为 `var params = buildBookContentParams(targetChapterIndex, bookUrl);`
- `preloadChaptersBatch()` 中同段参数一并改为 `buildBookContentParams(chapterIndex, currentBookUrl)`。
- `refresh` 由常开 `1` 改为 `0`：xread 在 `refresh>0` 时会删除该书全部正文缓存，逐章阅读会造成反复重爬；默认走服务端缓存，缺失时自动回源。

> 前提：`currentSourceUrl` 已在 `handleBookshelfClick()` 中由书籍 `origin` 赋值；`bookChapterMapCache` 在 `handleChapterListResponse()` 中由 `res.data` 填充（每项含 `url`）。无需额外改动章节列表逻辑。

### 3.2 `searchBookSource` —— 改用 `getAvailableBookSource`

**问题**
- kabi 调 `GET /reader3/searchBookSource?refresh&url&name&searchSize&lastIndex`。
- xread **无此路由**。`router.rs` 中只有：
  - `searchBookSourceSSE`（SSE 流式，`EventSource` 才能消费，kabi 的 `HttpGet`/`XMLHttpRequest` 模型不兼容）；
  - `getAvailableBookSource`（GET/POST，语义完全对应"为某本书在所有书源里搜可替代源"）。

**修复**：把路由常量指向 `getAvailableBookSource`，参数名 `searchSize → resultLimit`，并适配返回结构。

**改动 1 —— 接口常量（L18-27）**
```javascript
// 原： searchBookSource = "searchBookSource",
searchBookSource = "getAvailableBookSource",   // 改用 xread 的等价路由
```

**改动 2 —— `getSourceList()`（约 L1791）参数与分页**
```javascript
    var params = {
        refresh: refresh ? 1 : 0,
        url: currentBookUrl,
        name: currentBookName,
        author: currentAuthor,        // 新增：xread 用 name+author 兜底匹配书架书籍
        resultLimit: sourceBatchSize, // 原 searchSize → resultLimit（单次结果条数）
        lastIndex: refresh ? -1 : (bookSourceMapCache.length === 0 ? -1 : lastSourceIndex),
        concurrentCount: 6            // 并发探测书源数量
    };
```
- `getAvailableBookSource` 在 `router.rs` 中注册了 GET/POST，kabi 现有 `HttpGet(...)` 无需改方法。
- **返回结构必须以代码为准**：分页请求（带 `resultLimit` 且 `lastIndex` 为 -1 或 ≥0）返回 `{ books, lastIndex, hasMore }`（`AvailableBookSourceResponse`，camelCase）；不带 `resultLimit` 且 `lastIndex<0` 时返回**裸数组**。因此 `handleSourceListResponse()` 必须读 `res.data.books`，不能再用 `res.data.list`。
- 书源是"按书源逐个探测"的，一次只返回 `resultLimit` 条命中；`hasMore` 为真时用返回的 `lastIndex` 继续拉下一批。改动后 `jumpSourcePage()` 翻到缓存末尾会自动续拉一页。
- 列表项字段为 `SearchBook`：`name, author, bookUrl, origin, coverUrl, ...`（**没有 `originName`**），`createSourceButton()` 已改为优先显示 `originName`，缺失时退化为 `origin` 的域名。

### 3.3 `deleteBook` —— 补充 `bookUrl` 字段

**问题**
- xread `delete_book` 的入参是 `Json<Book>`（`#[serde(default, rename_all = "camelCase")]`），实际删除以 `book_url` 为准。
- kabi 只发送 `{refresh, url, name, author}`：`url` 不是 `Book` 字段（会被忽略），`book_url` 为空 → `delete_book` 返回 `书架书籍不存在`。

**修复 —— `deleteBookItem()`**
```javascript
    var params = {
        refresh: 1,
        url: currentBookUrl,
        bookUrl: currentBookUrl,       // 新增：xread 按 bookUrl 删除
        origin: currentSourceUrl,      // 新增：便于后端定位书源
        name: currentBookName,
        author: currentAuthor
    };
```

---

## 4. 配置改动（`js/config.js`）

```javascript
window.READER_CONFIG = {
    type: "multi",                              // 保持 multi，走 accessToken 鉴权
    address: "http://<xread-host>:7777",        // 指向 xread-fpk 后端（默认端口 7777，非原 4396）
    username: "<xread 账号>",
    password: "<xread 密码>",
    salt: "",
    contentFontSize: 47, lineHeight: 1.3, fontFamily: "系统默认",
    fontWeight: "normal", letterSpacing: 7,
    menuFontSizeRatio: 0.6, currentClickFunNum: 4,
    debugMode: false, debugLevel: 0
};
```
> 排版/翻页等其余配置保持不变。

---

## 5. 鉴权说明

- xread `AuthContext` 从 **query `accessToken`**（或 `Authorization: Bearer`）读取令牌（`auth.rs`）。kabi `url()` 已自动在 multi 模式附带 `accessToken`，**天然兼容**。
- kabi 在 multi 模式设置 `xhr.withCredentials = true`，但 xread 用令牌而非 Cookie 鉴权，该设置**无害**。
- xread 是**多用户模型**：每个 kabi 设备用各自 xread 账号登录，书架/进度按用户隔离（`user_ns`）。`getBookshelf`/`getChapterList` 等均以 `accessToken` 解析出 `user_ns` 再查数据。
- 若 xread 未配置安全密钥（默认 `secureEnabled=false`），`secureKeyRequired=false`，登录仍可正常下发 `accessToken`；建议仍为每台设备建独立账号以便进度隔离。

---

## 6. 可选：后端最小改动方案（不推荐）

若坚持**前端零改动**，可在 xread 新增兼容路由，但会偏离上游、增加同步成本，与"后端零改动"目标相悖，故不推荐：

- 新增别名路由 `GET/POST /reader3/searchBookSource`，内部转发到 `getAvailableBookSource` 逻辑。
- 新增别名路由 `GET/POST /reader3/getBookContent` 接收 `{url:bookUrl, index}`，内部解析 `bookUrl → toc → 第 index 章 → chapterUrl`，再调现有内容获取；同时需要让 `resolve_book_source` 能从 `book_url` 反查书源。

> 结论：前端两处改动（约 10 行）成本远低于维护后端补丁，优先选 §3 方案。

---

## 7. 验证清单

1. 启动 xread-fpk，确认 `GET /reader3/health` 与 `POST /reader3/login` 可达（默认 `:7777`）。
2. 改 `config.js` 指向后端、填账号，浏览器打开 xread-kindle 完成登录。
3. 端到端验证：
   - [ ] 书架正常加载（getBookshelf 字段一致）
   - [ ] 点书 → 目录加载（getChapterList）
   - [ ] 翻页正文可见（**重点：§3.1 改后 getBookContent 能返回正文**）
   - [ ] 换源列表出现（**重点：§3.2 改后 getAvailableBookSource 返回 books/lastIndex/hasMore 且能分页续拉**）
   - [ ] 删除书籍、保存进度正常（**重点：§3.3 改后 deleteBook 返回删除成功**）
4. 抓包确认请求路径均为 `/reader3/<router>?...&accessToken=...`，无 404（尤其确认不再出现 `/reader3/searchBookSource`）。

---

## 8. 实施记录（已落地）

| 文件 | 位置 | 改动 |
|---|---|---|
| `js/kindle.js` | 接口常量 | `searchBookSource` → `"getAvailableBookSource"` |
| `js/kindle.js` | 全局变量 | 新增 `hasMoreSource`、`sourceFetching`；`freshBookCache()` 同步重置 |
| `js/kindle.js` | 性能配置 | 新增 `sourceBatchSize = 30`（单次书源结果条数） |
| `js/kindle.js` | 新增函数 | `buildBookContentParams()`：有章节 URL 走 `chapterUrl+bookSourceUrl`，否则回退 `url+index` |
| `js/kindle.js` | `getBookContent()` / `preloadChaptersBatch()` | 改用 `buildBookContentParams()`，`refresh` 常开 1 → 0 |
| `js/kindle.js` | `getChapterList()` | 附带 `bookSourceUrl`，`refresh` 由固定 1 改为按入参 |
| `js/kindle.js` | `getSourceList()` / `handleSourceListResponse()` | 参数改 `resultLimit`/`concurrentCount`，解析 `data.books`，支持 `hasMore` 续拉 |
| `js/kindle.js` | `jumpSourcePage()` | 缓存翻到末尾时可继续向服务端拉取下一页书源 |
| `js/kindle.js` | `createSourceButton()` | 无 `originName` 时用 `origin` 域名作显示名 |
| `js/kindle.js` | `deleteBookItem()` | 补 `bookUrl` / `origin` |
| `js/config.js` | `address` | 指向 `http://192.200.217.59:7777`（xread 默认端口，按实际部署改） |

已通过 `node --check` 语法校验，未改动任何后端代码。

**联调验证（模拟 xread 后端 + 无头 Chromium 实际驱动页面）**

| 验证项 | 结果 |
|---|---|
| 目录接口请求体 | `{refresh:1, url:"http://src.test/book/1", bookSourceUrl:"http://src.test"}`，返回 10 章 ✅ |
| 正文接口请求体 | `{chapterUrl:"http://src.test/txt/1_3.html", bookSourceUrl:"http://src.test", refresh:0}`，**不含 `index`** ✅ |
| 换源首批 | 参数 `resultLimit=30&lastIndex=-1&concurrentCount=6`，解析 `data.books` 得 10 条，`hasMore=true` ✅ |
| 换源翻页续拉 | 第 2 页自动以 `lastIndex=5` 续拉，累计 20 条、`hasMore=false`、页码 2/2 ✅ |
| 书源显示名 | 无 `originName` 时回退为域名，如「书源11 - s10.test」 ✅ |
| 删除书籍请求体 | `{bookUrl, origin, name, author, url, refresh}`，后端可正确删除 ✅ |
| 页面 JS 错误 | 全程无 `PAGEERROR` / 控制台报错 ✅ |

> 注：以上为离线模拟验证（沙箱无法直连真实后端），真实环境仍需按 §7 清单在 Kindle 上跑一遍。
