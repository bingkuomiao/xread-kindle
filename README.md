# XRead Kindle（xread-kindle）

Kindle / 手机 / PC 三端自适应的静态阅读器前端，对接 xread-fpk（reader3 体系）后端。
后端零改动；前端配置服务器地址后即可渲染书架、目录、正文、书源。

## 代码仓库

- 本仓库（前端）：`https://github.com/bingkuomiao/xread-kindle`
- 后端：`https://github.com/bingkuomiao/xread-fpk`（reader3 / "阅读3" 体系的自托管 fork）

## 目录结构

```
index.html          主 HTML 页面（配置字体/翻页/书籍、书架、登录、关于本机）
css/kindle.css      三端统一样式（结构/字号/弹窗等，全局唯一来源）
css/other.css       手机/PC 适配补充（.xread-browser 作用域）
js/config.js        全局配置 window.READER_CONFIG（服务器地址、字体、行距等）
js/kindle.js        阅读器逻辑（书架/目录/正文/书源/设置交互）
fonts/              本地字体（@font-face 静态资源，不经过后端接口）
img/                图片资源（封面占位、图标、logo）
API文档.md           后端 REST 接口文档
对接xread-fpk改动方案.md  前端对接后端的改动说明
```

## 版本

- 后端版本：`appVersion = 1.0.48`（不变）
- 前端版本：见 `index.html` 中 `frontVersion`（随每次前端改动升级，形如 `1.0.48.xx`）
- FPK 产物：`xread-native-<版本>.fpk`（由构建源打包）

## 构建与发布

前端源码在构建源 `/workspace/build-xread/app/kindle/`，打包前同步至本仓库。
SW 缓存名与静态资源 `?v=` 随版本升级，用于刷新真机缓存。
HTML 使用 LF；CSS/JS 使用 CRLF；JS 保持 ES5 / Kindle WebKit 534 兼容。

## 约定

- 三端样式统一在 `css/kindle.css` 维护，避免按终端重复覆盖。
- `<select>` 等表单控件在 Kindle 老内核下的垂直居中/留白需特殊处理。
