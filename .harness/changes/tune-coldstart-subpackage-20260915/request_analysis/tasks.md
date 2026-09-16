# tasks：冷启动分包重构

> 每任务独立可验证；T1-T4 无相互依赖可任意顺序，T5 依赖 T1-T4 全部完成，T6 收口。

## T1 死重清理
- 删 `pages/aiEnhance/`（未注册无入口）+ `images/placeholder.png`（无引用）
- 验证：`grep -r aiEnhance` 无残留引用；app.json 本就无注册

## T2 建 pkgGif
- `git mv` 5 页（makeGif/gifEditor/gifBatch/gifReport/gifDrafts）→ `pkgGif/pages/`
- `git mv` 6 utils（gif-encoder/decoder/report/compress/effects/frame-ops）→ `pkgGif/utils/`
- 修正分包页 require 主包（image-process/analytics/content-check 等）`../../` → `../../../`（页面三层）
- 修正 **pkgGif/utils/gif-encoder.js:20** `./color-quantize.js` → `../../utils/color-quantize.js`（color-quantize 留主包，Critical；utils 文件两层深）
- gif-compress.js 的 `./gif-encoder.js`/`./gif-frame-ops.js` 同包不动
- 验证：`grep -rn "require('./" pkgGif/utils/` 逐条确认目标同包或已改；**用 node 脚本解析 pkgGif/ 下全部 require 并核验目标文件存在**（替代前缀口径——分包页引本包 utils 与包内 utils 引主包同为 `../../utils/` 前缀，前缀 grep 无法区分合法性）；工具编译无错

## T3 建 pkgAi
- `git mv` 12 页 → `pkgAi/pages/`；`colorize-detect.js` → `pkgAi/utils/`
- require 修正同 T2；**colorize-detect.js:10** `./image-process` → `../../utils/image-process`（utils 两层深）
- 验证同 T2（含 `require('./` 扫描）

## T4 建 pkgTools
- `git mv` 7 页（exif/similarity/formatRecommend/colorAnalysis/hiddenWatermark/pdfToImage/imgToPdf）→ `pkgTools/pages/`
- `git mv` 5 utils（piexif/exif-tags/image-hash/format-recommend/hidden-watermark）→ `pkgTools/utils/`（**color-quantize 不迁**，留主包）
- require 修正同 T2（注意 exif.js 的 `../../utils/piexif.js` 带 .js 后缀、指向本包**不变**）
- **image-hash.js:17** `./image-process` → `../../utils/image-process`；**format-recommend.js:20** `./color-quantize` → `../../utils/color-quantize`（utils 两层深）
- 验证同 T2（含 `require('./` 扫描）

## T5 注册与入口更新
- `app.json`：pages 留 9 页 + subpackages + preloadRule（index→all→[pkgAi]）
- `pages/index/index.js`：全部 url 前缀更新（~26 处）
- 全仓 grep 旧路径硬编码，**带引号左边界模式**：`grep -rnE "['\"]/pages/(ai[A-Z]|gif|makeGif|exif|similarity|formatRecommend|colorAnalysis|hiddenWatermark|pdfToImage|imgToPdf)" --include=*.js --include=*.json --include=*.wxml`，期望 0 命中（裸 `/pages/ai` 会匹配新路径 `/pkgAi/pages/...` 假阳性，禁用）
- 复核迁移页 json 无相对路径形式的 usingComponents（当前已确认 image-uploader 全为绝对路径）

## T6 编译与体积核对
- 微信开发者工具编译 0 error；代码依赖分析：主包 <600K、三分包各 <500K
- 产出体积数字进 coding_report
