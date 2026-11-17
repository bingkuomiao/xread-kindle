# xread-kindle 对接的后端 API 接口文档

> 整理来源：`index.html`、`js/config.js`、`js/kindle.js`
> 项目性质：纯静态前端阅读器（HTML/CSS/JS），通过 `window.READER_CONFIG` 配置服务器，调用后端 REST 接口渲染书架、目录、正文、书源。
> 代码仓库：`https://github.com/bingkuomiao/xread-kindle`（私有库，经 GitHub MCP 连接器读取）

---

## 1. 服务器与请求基础规则

### 1.1 服务器配置（`js/config.js`）

```javascript
window.READER_CONFIG = {
    type: "multi",                       // 服务器类型：app | single | multi
    address: "",                          // 留空=自动同源（与 js/config.js 当前实际配置一致）
    username: "",
    password: "",
    salt: "",
    contentFontSize: 47, lineHeight: 1.3, fontFamily: "系统",
    fontWeight: "normal", letterSpacing: 7,
    menuFontSizeRatio: 0.6, currentClickFunNum: 4,
    debugMode: false, debugLevel: 0
};
```

### 1.2 请求地址构造（`url(router, data)` 函数，js/kindle.js）

所有接口路径都由 `url()` 统一拼接，**后端所有接口都挂在 `/reader3/` 前缀下**（仅 `app` 模式去掉此前缀，直接 `/{router}`）：

| 服务器类型 | 实际请求地址 | Token 传递 |
|-----------|-------------|-----------|
| `app`     | `{address}/{router}?v={ts}&accessToken=app` | 固定 `app` |
| `single`  | `{address}/reader3/{router}?v={ts}` | 无（固定 `single`） |
| `multi`   | `{address}/reader3/{router}?v={ts}&accessToken={token}` | 登录后下发的 `accessToken` |

- `v={ts}` 为时间戳缓存破坏参数（`new Date().getTime()`）。
- `data` 对象中的键值对以 `&key=encodeURI(value)` 形式追加到 query（主要用于 GET 接口）。
- 对 `multi` 模式，前端还设置 `xhr.withCredentials = true`，即**同时依赖 Cookie 会话**。

### 1.3 鉴权模型（重点）

1. 打开页面进入登录界面，`checkLoginState()` 检查内存变量 `accessToken` 是否存在（js/kindle.js）。
2. `multi` 模式下，用户提交用户名密码 → `loginBookshelf()` 调 `login` 接口（js/kindle.js）。
3. 登录成功后后端返回 `res.data.accessToken`，前端存入全局 `accessToken`（js/kindle.js），随后每个 `multi` 请求都通过 `url()` 自动带上 `accessToken` 参数 + Cookie。
4. 登出 `sendLogoutRequest()` 清空 `accessToken`，并调用 `logout` 接口（js/kindle.js）。

> ⚠️ 密码目前**未加密**：`decode()` / `encode()` 均为原样返回（js/kindle.js），传输为明文 JSON。

---

## 2. 接口清单（共 9 个）

> 约定：`{base}` = 按 1.2 规则拼出的地址；`{addr}` = `config.address`。

### 2.1 登录 `login`

- **方法**：`POST`
- **路径**：`{addr}/reader3/login`
- **Content-Type**：`application/json;charset=utf-8`
- **请求体**：

```json
{
  "isLogin": true,
  "username": "配置的用户名",
  "password": "decode(密码)",
  "code": ""
}
```

- **响应**：

```json
{
  "isSuccess": true,
  "errorMsg": "",
  "data": { "accessToken": "登录令牌字符串" }
}
```

- **前端处理**：`res.data.accessToken` → 全局 `accessToken`（js/kindle.js）。
- **调用位置**：`loginBookshelf()`（仅 `multi` 模式使用账号密码）。

### 2.2 登出 `logout`

- **方法**：`POST`
- **路径**：`{addr}/reader3/logout`
- **请求体**：`null`（前端 `JSON.stringify(null)`）
- **鉴权**：`accessToken`（multi/single）
- **调用位置**：`sendLogoutRequest()`（js/kindle.js），登出前会先同步保存阅读进度。

### 2.3 获取书架 `getBookshelf`

- **方法**：`GET`
- **路径**：`{addr}/reader3/getBookshelf`
- **Query**：`refresh=0`（外加 `v`、`accessToken`）
- **响应 `res.data`**：书籍对象数组，前端按 `durChapterTime` 倒序展示。单个书籍对象字段：

| 字段 | 说明 |
|------|------|
| `name` | 书名 |
| `author` | 作者 |
| `bookUrl` | 书籍在源站的唯一 URL（核心标识，所有章节/内容/进度/删除接口都用它） |
| `origin` | 书源 URL（currentSourceUrl） |
| `coverUrl` | 封面图路径；若为相对路径则拼 `{addr}` 前缀，空则用 `img/noCover.jpg` |
| `customCoverUrl` | 自定义封面（优先于 coverUrl） |
| `totalChapterNum` | 总章节数 |
| `durChapterTitle` | 已读到章节标题（去掉前 5 字符前缀显示） |
| `durChapterIndex` | 已读章节索引 |
| `durChapterPos` | 已读章节内位置 |
| `durChapterTime` | 最近阅读时间戳（用于排序） |
| `latestChapterTitle` | 最新章节标题 |
| `latestChapterTime` | 最新章节更新时间戳 |

- **调用位置**：`getBookshelf()`（js/kindle.js）。

### 2.4 获取章节列表 `getChapterList`

- **方法**：`POST`（`app` 模式为 `GET`）
- **路径**：`{addr}/reader3/getChapterList`
- **请求体（POST）**：

```json
{ "refresh": 1, "url": "{bookUrl}" }
```

- **响应 `res.data`**：章节对象数组，每项 `{ index: 序号, title: 章节标题 }`。前端缓存到 `bookChapterMapCache`，并做标题清洗（去非法字符、中文数字转阿拉伯）。
- **前端分页**：本地按 `showChapterListNum=16` 分页展示，不直接依赖后端分页参数。
- **调用位置**：`getChapterList()`（js/kindle.js）。

### 2.5 获取章节内容 `getBookContent`

- **方法**：`POST`（`app` 模式为 `GET`）
- **路径**：`{addr}/reader3/getBookContent`
- **请求体（POST）**：

```json
{ "index": 章节序号, "refresh": 1, "url": "{bookUrl}" }
```

> 预加载场景 `refresh=0`（js/kindle.js）。

- **响应 `res.data`**：字符串，即该章节的**纯文本正文**（前端会拼接章节标题 + 段首缩进两个全角空格后分页渲染）。
- **调用位置**：`getBookContent()`（js/kindle.js）、`preloadChaptersBatch()`（预加载，js/kindle.js）。

### 2.6 保存阅读进度 `saveBookProgress`

- **方法**：`POST`
- **路径**：`{addr}/reader3/saveBookProgress`
- **请求体（普通模式）**：

```json
{
  "index": 章节序号,
  "refresh": 1,
  "url": "{bookUrl}",
  "name": "书名(可选)",
  "author": "作者(可选)"
}
```

- **请求体（`app` 模式，覆盖写法，js/kindle.js）**：

```json
{
  "name": "书名",
  "author": "作者",
  "durChapterIndex": 章节序号,
  "durChapterTime": 时间戳,
  "durChapterTitle": "章节标题"
}
```

- **同步保存**：页面卸载等关键场景用 `saveReadProcessSync()` 发**同步** POST（js/kindle.js）。
- **响应**：`{ isSuccess, errorMsg }`。成功后前端更新 `currentChapterIndex`。
- **调用位置**：切章 / 翻页时自动调用（js/kindle.js）。

### 2.7 搜索书源 `searchBookSource`

- **方法**：`GET`（app 与非 app 均为 GET）
- **路径**：`{addr}/reader3/searchBookSource`
- **Query**：

```
refresh=0&url={bookUrl}&name={bookName}&searchSize={pageSize}&lastIndex={sourceIndex}&v=...&accessToken=...
```

- **响应 `res.data`**：

```json
{
  "list": [
    { "bookUrl": "该书源下的书籍URL", "origin": "书源URL", "originName": "书源显示名" }
  ],
  "lastIndex": "下一页游标"
}
```

- **前端分页**：本地按 `sourcePageSize=10` 缓存拼接（`bookSourceMapCache`）。
- **调用位置**：`getSourceList()`（js/kindle.js）。

### 2.8 设置书源 `setBookSource`

- **方法**：`POST`
- **路径**：`{addr}/reader3/setBookSource`
- **请求体**：

```json
{
  "refresh": 0,
  "newUrl": "新选择的书籍URL",
  "bookUrl": "当前书籍URL(旧)",
  "bookSourceUrl": "新选择书源的 origin"
}
```

- **响应 `res.data`**：`{ origin: "切换后实际生效的书源URL" }`，`res.isSuccess` 标记成功。
- **前端处理**：成功后更新 `currentBookUrl`/`currentSourceUrl` 并重新加载内容（js/kindle.js）。
- **调用位置**：`setReadSource()`（js/kindle.js）。

### 2.9 删除书籍 `deleteBook`

- **方法**：`POST`
- **路径**：`{addr}/reader3/deleteBook`
- **请求体**：

```json
{ "refresh": 1, "url": "{bookUrl}", "name": "书名", "author": "作者" }
```

- **响应**：`{ isSuccess, errorMsg }`。成功后前端重新拉取书架（`getBookshelf()`）。
- **调用位置**：`deleteBookItem()`（js/kindle.js）。

---

## 3. 隐含的图片资源接口

书架封面不是独立 API，而是由后端**静态文件服务**提供：

- 当书籍 `coverUrl` 不以 `http` 开头时，前端拼接为 `{addr}{coverUrl}`（js/kindle.js）。
- 因此后端需能直接以 GET 返回该封面图片（路径由 `getBookshelf` 返回数据给出）。
- 加载失败的兜底图为 `img/noCover.jpg`（前端本地资源）。

---

## 4. 接口总览表

| # | 接口常量 | 路由 | 方法 | 鉴权 | 关键参数 | 响应核心 |
|---|---------|------|------|------|---------|---------|
| 1 | `login` | `/reader3/login` | POST | 无 | `username,password,code` | `data.accessToken` |
| 2 | `logout` | `/reader3/logout` | POST | token+cookie | 无 | `isSuccess` |
| 3 | `getBookshelf` | `/reader3/getBookshelf` | GET | token+cookie | `refresh` | 书籍数组 |
| 4 | `getChapterList` | `/reader3/getChapterList` | POST/GET | token+cookie | `url` | 章节数组`{index,title}` |
| 5 | `getBookContent` | `/reader3/getBookContent` | POST/GET | token+cookie | `index,url` | 正文字符串 |
| 6 | `saveBookProgress` | `/reader3/saveBookProgress` | POST | token+cookie | `index,url,name?` | `isSuccess` |
| 7 | `searchBookSource` | `/reader3/searchBookSource` | GET | token+cookie | `url,name,searchSize,lastIndex` | `data.list, data.lastIndex` |
| 8 | `setBookSource` | `/reader3/setBookSource` | POST | token+cookie | `newUrl,bookUrl,bookSourceUrl` | `data.origin` |
| 9 | `deleteBook` | `/reader3/deleteBook` | POST | token+cookie | `url,name,author` | `isSuccess` |

---

## 5. 前端依赖的后端能力小结

要跑通该阅读器，**后端至少需要实现上述 9 个 JSON 接口**，并保证：

1. 所有接口挂在 `/reader3/` 前缀（除非 `app` 模式）。
2. 统一返回结构：`{ isSuccess: boolean, errorMsg: string, data: any }`。
3. `multi` 模式支持 `accessToken` 校验 + Cookie 会话；`login` 下发 `accessToken`。
4. 提供书籍封面、正文的静态/动态访问；`bookUrl` 是贯穿所有接口的主键。
5. 本地字体（`fonts/*.woff`）由前端直接加载，不依赖后端接口。

---

## 6. 附录：前端依赖的字体文件（本地静态资源）

字体由 `css/kindle.css` 通过 `@font-face` 直接引用，**不经过后端接口**，需以文件形式放在 `fonts/` 目录下。当前仓库 `fonts/` 目录共有 3 个（均随仓库提供）：

| 文件名 | CSS 字体名 | 用途 |
|--------|-----------|------|
| `fonts/YuFengKaiTi.woff` | 御风楷体 | 楷体风格 |
| `fonts/NuoMiYuanTi.woff` | 糯米圆体 | 圆体风格 |
| `fonts/yunduo.woff` | 云朵字体 | 云朵风格 |

> 前端 `fontFamilyMap`（js/kindle.js）将配置项映射到上述字体名；默认配置 `fontFamily: "系统"`，即不加载自定义字体。

> 上述 3 个字体文件已随仓库提供于 `fonts/` 目录，构建 FPK 时一并打包，无需额外下载或复制。
