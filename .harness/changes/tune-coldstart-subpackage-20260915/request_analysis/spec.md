# spec：冷启动优化——主包分包重构 + 死重清理

- 类型：tune（性能优化，纯前端工程结构调整）
- 日期：2026-09-15（北京）
- 背景数据源：We分析 小程序全局诊断日报 2026-09-14

## 1. 问题与根因

**现象**：平均冷启动耗时当前 1439.5ms，基准 360ms（+299.9%），归因版本 5.0.1（贡献度 100%）。

**数据解读（重要）**：
- 走势 09-08:2877 → 09-11:360 → 09-12:1439.5，剧烈震荡 = 小样本长尾主导均值；
- 唯一在网版本 5.0.1 发布于 07-19，飙升发生在 09-08，期间无新代码发布 → 归因"版本"无信息量；
- 最可能根因：推广期（小红书/公众号引流）**首装新用户占比上升**——首装冷启动需全量下载主包。

**代码侧唯一可控杠杆**：33 个注册页面全部在主包（pages 1282K + utils 312K ≈ 1.65MB 源码），无 subpackages、无 preloadRule。GIF 功能上线已把包体顶到 2MB 上限（见 commit d80aca2 "fix: 上传大于2MB，调整"）。

**已做对、不再动的部分**：`lazyCodeLoading: "requiredComponents"`（app.json:46）、app.js onLaunch 轻量、首页 onLoad 轻量、无 tabBar、无 UI 库。

## 2. 方案总览（用户已裁决：激进分包）

四件事：
1. **三分包**：pkgAi / pkgGif / pkgTools，主包只留 index + 8 个高频工具页；
2. **preloadRule**：首页全网络预下载 pkgAi；
3. **utils 随页迁移**（依赖图已验证，见 §4）；
4. **死重清理**：`pages/aiEnhance/`（17K，未注册无入口，2026-03 遗留）+ `images/placeholder.png`（35K，全仓无引用）。

**不涉及**：云函数三件套、限流、密钥、内容安全（`content-check.js` 留主包，分包页照常 require）、设计 token（wxss 随页整体迁移，内容不改）。

## 3. 页面落位清单

### 主包（9 页，~470K 源码）
| 页面 | 依据 |
|---|---|
| index | 入口 |
| compress / crop / convert / watermark / filter / splice / compare | 高频基础工具 |
| idPhoto | 商业价值高（首页精选前3） |

### pkgAi（12 页 + 1 util，~408K）
aiDescribe, aiCaption, aiMatting, aiStyle, aiOCR, aiEraser, aiUpscale, aiColorize, aiChat, aiOutpaint, aiTextToImage, aiAvatar
- 迁入 util：`colorize-detect.js`（仅 aiColorize 引用）

### pkgGif（5 页 + 6 utils，~309K）
makeGif, gifEditor, gifBatch, gifReport, gifDrafts
- 迁入 utils：gif-encoder / gif-decoder / gif-report / gif-compress / gif-effects / gif-frame-ops（仅被本包 4 页引用：makeGif/gifBatch/gifEditor/gifReport，gifDrafts 不直接用；makeGif 依赖 gif-encoder，故随包走）

### pkgTools（7 页 + 5 utils，~372K）
exif, similarity, formatRecommend, colorAnalysis, hiddenWatermark, pdfToImage, imgToPdf
- 迁入 utils：piexif.js(78K) / exif-tags.js / image-hash.js / format-recommend.js / hidden-watermark.js

### 留主包的 utils / components（被主包页、全局、或跨分包引用）
- image-process.js（14 页 + image-uploader 组件引用，分包可 require 主包）
- analytics.js、content-check.js（全局/多数页引用）
- compare-helper.js（主包 4 页 + pkgAi 多页引用）
- upscale-local.js（crop/aiUpscale/aiColorize 引用）、saliency-detect.js（crop 引用）
- id-photo-geometry.js（idPhoto 引用，idPhoto 留主包）
- **color-quantize.js（Critical 修正）**：被 `pkgGif/utils/gif-encoder.js:20`（懒加载 medianCut）和 `pkgTools/utils/format-recommend.js:20` 双跨分包引用 → 必须留主包（7.8K），两处引用改 `../../utils/color-quantize`（utils 文件两层深，**不是**页面的三层规则）
- `components/image-uploader/`：被 compress/splice（主包）+ aiAvatar/aiOutpaint/aiStyle/aiTextToImage（→pkgAi）经 `usingComponents` **绝对路径** `/components/...` 引用 → 留主包，零改动

## 4. 依赖图验证结论（已 grep 全仓）

- `utils/xxx` 引用形式两种：`require('../../utils/piexif.js')`（带 .js 后缀）与 `require('../../utils/image-process')`（不带）。**迁移时 grep 必须两种模式都查**（本 spec 前期分析曾因只查不带后缀形式漏报 piexif 引用）。
- 分包页面 require 主包 utils 合法（`../../../utils/x`）；反向（主包 require 分包）非法——已验证不存在反向依赖。
- 分包内部镜像 `pkgX/utils/` 目录结构后，**页面对本包 utils 的相对路径 `../../utils/x` 不变**，仅需改引用主包的路径为三层 `../../../`（页面在 `pkgX/pages/<name>/` 共三层深）。
- **注意层级**：被迁移的 utils 文件在 `pkgX/utils/` 只有两层深，指向主包 utils 用**两层** `../../utils/`；三层 `../../../` 是页面专属规则，套到 utils 上会跳出项目根（评审 N-1 教训）。
- **被迁移 utils 自身的内部 require（评审 Important 修正）**，逐处定点修：
  | 文件（迁后位置） | 原 require | 改为 |
  |---|---|---|
  | pkgAi/utils/colorize-detect.js:10 | `./image-process` | `../../utils/image-process` |
  | pkgTools/utils/image-hash.js:17 | `./image-process` | `../../utils/image-process` |
  | pkgTools/utils/format-recommend.js:20 | `./color-quantize` | `../../utils/color-quantize` |
  | pkgGif/utils/gif-encoder.js:20 | `./color-quantize.js` | `../../utils/color-quantize.js` |
  | pkgGif/utils/gif-compress.js:19,20 | `./gif-encoder.js` / `./gif-frame-ops.js` | **不变**（同包） |
- 迁移 utils 时必须 grep `require('./` 全扫一遍，`./` 目标要么同包要么已列入上表，不允许漏网。

## 5. 具体改动

1. `git mv` 页面目录：`pages/aiXxx` → `pkgAi/pages/aiXxx`（12 个）、`pkgGif/pages/`（5 个）、`pkgTools/pages/`（7 个）。
2. `git mv` utils：`utils/piexif.js` 等 12 个文件 → 各分包 `utils/`（pkgTools 5 个 + pkgGif 6 个 + pkgAi 1 个，见 §3；color-quantize 不迁）。
3. **require 修正**：分包页引用主包 utils/image-process、analytics、content-check、compare-helper、upscale-local 的 `../../utils/` → `../../../utils/`；引用本包 utils 的不变。
4. `app.json`：`pages` 只留 9 页；新增 `subpackages`（3 个，root+pages）+ `preloadRule`（`pages/index/index` → network:all → `["pkgAi"]`）。
5. `pages/index/index.js`：groups/featured 全部 url 前缀更新（约 26 处 `/pages/` → `/pkgX/pages/`）。
6. 全仓 grep 硬编码旧路径，**用带引号左边界的模式**（评审 Important 修正：裸 `/pages/ai` 会匹配新路径 `/pkgAi/pages/aiXxx` 造成全面假阳性）：`grep -rnE "['\"]/pages/(ai[A-Z]|gif|makeGif|exif|similarity|formatRecommend|colorAnalysis|hiddenWatermark|pdfToImage|imgToPdf)" --include=*.js --include=*.json --include=*.wxml`，期望 0 命中。分享 path/navigator 跳转的硬编码均已确认在该模式覆盖内。
7. `usingComponents` 引用 `components/image-uploader` 已确认全部为绝对路径 `/components/...`，迁移页 json 无需改动（编码时仍 grep 复核一遍相对路径形式的组件引用）。
8. 删除：`pages/aiEnhance/`、`images/placeholder.png`。

## 6. 风险与已知代价

| 风险 | 影响 | 处置 |
|---|---|---|
| 老分享卡片/外部直达链接指向旧路径 | 打开降级到首页（微信行为） | 接受：项目早期，外链存量小 |
| require 漏改 | 开发者工具编译报错 | 静态双验证：工具编译 + 全仓 grep 两种 require 形式 |
| 首次进 pkgGif/pkgTools 有分包下载等待 | 低频页秒级 loading | 预期行为；pkgAi 已 preload 规避 |
| preloadRule network:all 消耗用户流量（~410K） | 4G 用户首访多耗流量 | 接受（AI 为商业重点）；可后续改 wifi |
| 分包各自独立缓存 | 微信分包缓存策略与主包独立 | 无需处理 |

## 7. 验收标准

1. 开发者工具编译 **0 error**；「代码依赖分析」主包 < 600K（源码口径 ~470K，含 minify 余量）；
2. 33 个注册页面（app.json 现有 33 页不变；aiEnhance 本就未注册，删除不影响注册数）真机预览全部可达；
3. 功能抽测 5 条链路：compress（主包内）、aiMatting（分包→主包 utils）、gifEditor（分包内 utils + gif-encoder）、exif（piexif 迁移后 EXIF 读正常）、pdfToImage（云函数链路不受影响）；
4. 上线后次日 We分析 冷启动 P50/P90 对比（数据侧观察项，非阻塞验收）。

## 8. 并行行动项（用户，方案 B）

- mp 后台 → 版本管理：核实 09-08 前后是否有未 bump 版本号的重新发布；
- We分析 → 性能 → 启动分析：看 P50/P90 + 启动漏斗（下载/注入/渲染）定位慢在哪段；
- We分析 → 用户：09-08 前后新用户占比是否跳升（验证首装假设）。

## 9. 必问清单对照

| 项 | 答案 |
|---|---|
| 执行层 | 纯 on-device 工程结构，无云函数改动 |
| 页面注册 | app.json pages+subpackages、index.js urls；无新增页面（LAUNCH_DATES/icon 不动） |
| 云函数三件套 | 不涉及 |
| 限流 featureKey | 不涉及 |
| 密钥 | 不涉及 |
| 内容安全 | 不涉及（分层不变） |
| 设计 token | 不涉及（wxss 随页迁移不改内容） |
| 成功标准 | §7 |
