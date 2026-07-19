# 需求分析：小程序搜索爬虫优化（对照官方《小程序搜索优化指南》）

- 类型：tune
- 创建：2026-07-19（北京）
- 来源：用户提供官方《小程序搜索优化指南》，要求评估并调整可优化项

## 一、背景

微信官方搜索爬虫（user-agent `mpcrawler`，场景值 1129）抓取小程序页面时有 6 条优化建议。
本需求对照指南逐条评估现状后，落地可执行优化。

## 二、现状评估（逐条对照指南）

| 指南要点 | 现状 | 结论 |
|---|---|---|
| 1. 页面可被直接打开、参数含 url | 工具页均页内 `chooseImage` 自取图，无跨页图片依赖；唯一 globalData 读取是 `secretConfigured` 布尔（AI 可用性提示，非业务必需） | ✅ 合规，无需动 |
| 2. 优先 navigator 组件 | 首页工具卡/热门场景卡均 `bindtap`+`wx.navigateTo`（index.js:439/451） | ⚠️ **本次优化** |
| 3. 清晰简洁页面参数 | 全项目零 `JSON.stringify` 作 url 参数，工具页基本无 query | ✅ 合规 |
| 4. 必要时才授权 | 仅 `scope.writePhotosAlbum` 且点"保存相册"时触发；无 login/手机号/资料授权 | ✅ 优秀 |
| 5. 不收录 web-view | 全项目零 web-view | ✅ 合规 |
| 6. 清晰标题和缩略图 | 28 页 json 均 SEO 富关键词标题；onShareAppMessage 全覆盖；但 imageUrl 多为空 | △ 缩略图本次不做（用户决策） |

## 三、本次范围（用户已通过 AskUserQuestion 决策）

**纳入：**
1. **navigator 改造**（指南要点 2，收益最高）：首页「热门场景卡」+「工具卡」由 `bindtap`+`navigateTo` 改为 `<navigator url>` 组件，让爬虫从 DOM 链接形态发现页面 URL。
2. **sitemap 覆盖最大化**（指南要点 1/2 配套）：sitemap.json 当前仅显式 allow 11 页，其余靠默认 allow，注释"聚焦核心页"与行为不符。按用户决策「覆盖最大化」，把全部已上线且有 SEO 标题的 29 页全部显式 allow，注释同步更正。

**不纳入（用户决策）：**
- 分享/爬虫缩略图（imageUrl）：本次不做，后续单独处理。

**附带提示（不在本次动手）：**
- `pages/aiEnhance/` 是完整四件套页面但未在 app.json 注册（有 2 commit 历史），疑似废弃功能。与搜索优化主题不直接相关，遵循「不顺手无关改动」，本次不动，仅记入 summary 提示，留待用户单独裁决。

## 四、三层落位

本变更**纯前端 + 配置**，无云函数、无 utils 引擎、无新增页面：

| 层 | 文件 | 改动 |
|---|---|---|
| 前端 page | `pages/index/index.wxml` | 热门场景卡/工具卡外层 `view`+`bindtap` → `<navigator url hover-class="none">` |
| 前端 page | `pages/index/index.js` | `onToolTap`/`onSceneTap` 去掉 `wx.navigateTo`（由 navigator 接管）；保留 `onToolTap` 的 `available=false` 拦截 toast；保留 `onSceneTap` 埋点 |
| 配置 | `sitemap.json` | 补全至 29 页全 allow，更正注释 |

## 五、硬约束对照

- **设计 token / 主题**：不改 wxss，不动颜色/间距/按钮单行规则。`tool-card`/`hot-scene-card` 的 `:active` 反馈保留——navigator 设 `hover-class="none"` 禁用默认遮罩，让 CSS `:active` 继续生效。
- **bindtap 事件对象坑（memory: wx-bindtap-event-arg-and-no-stoppropagation）**：navigator 上的 `bindtap` 首参仍是事件对象；`onToolTap`/`onSceneTap` 已用 `e.currentTarget.dataset` 取值，改后沿用，不破坏。
- **dataset 字符串坑（memory: wx-dataset-index-string-vs-number）**：`onToolTap` 的 `available` 经 dataset 是字符串，现有 `available === 'true' || available === true` 双重判断保留。
- **页面注册 4 处**：本次不新增页面，不动 app.json/index.js groups/LAUNCH_DATES/index.wxss icon。
- **无云函数/无限流/无密钥/无内容安全**：N/A。

## 六、navigator 改造细节

### 工具卡（.tool-card，含 available 拦截）
外层 `<view bindtap="onToolTap">` → `<navigator url="{{item.available ? item.url : ''}}" hover-class="none" bindtap="onToolTap">`。
- `available=true`：url 有值，navigator 跳转（爬虫可发现 URL）；`onToolTap` 不再调 navigateTo。
- `available=false`：url 为空串，navigator 不跳转；`onToolTap` 检测 available=false 显示"功能开发中"toast。保留 `.disabled` 样式。

### 热门场景卡（.hot-scene-card，全 available）
外层 `<view bindtap="onSceneTap">` → `<navigator url="{{item.url}}" hover-class="none" bindtap="onSceneTap">`。`onSceneTap` 保留 `analytics.track` 埋点，去掉 `wx.navigateTo`。

## 七、sitemap 补全清单（覆盖最大化）

显式 allow 全部 29 页（与现有逐页列出风格一致，无歧义、易维护）：
- 已 allow 11 页：index, idPhoto, aiEraser, aiMatting, pdfToImage, imgToPdf, aiColorize, aiUpscale, aiOCR, aiTextToImage, compress
- 新增 allow 18 页：crop, convert, watermark, filter, splice, aiDescribe, aiCaption, aiStyle, compare, exif, aiChat, similarity, makeGif, colorAnalysis, formatRecommend, hiddenWatermark, aiOutpaint, aiAvatar

## 八、成功标准 + 验证用例

1. 首页真机：点任意工具卡 → 正常跳转对应页；点 `available=false` 卡（若有）→ toast"功能开发中"不跳转。
2. 首页真机：点热门场景卡 → 正常跳转；埋点 `hot_scene_click` 仍上报。
3. 视觉：工具卡/场景卡点击仍有 `:active` scale 反馈，无 navigator 默认半透明遮罩叠加。
4. sitemap.json 语法合法（微信开发者工具编译无 sitemap 报错）。
5. 静态：index.wxml 结构闭合正确，index.js 无 navigateTo 残留调用（onToolTap/onSceneTap 内）。
