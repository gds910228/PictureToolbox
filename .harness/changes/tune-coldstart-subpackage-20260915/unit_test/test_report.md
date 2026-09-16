# 验证用例清单（[适配] 手动验证，替代单测）

- 日期：2026-09-15（北京）
- 执行环境：微信开发者工具编译通过后 → **真机预览**（预览二维码），Console + 云开发控制台日志
- 图例：每条含「场景 / 步骤 / 预期 / 证据」；证据缺一不可（verification-before-completion 铁律）

## A. 构建门禁（阶段 7，开发者工具）

| # | 场景 | 步骤 | 预期 | 证据 |
|---|---|---|---|---|
| A1 | 编译 | 工具栏「编译」 | 0 error（warning 可容忍但需记录） | Console 截图 |
| A2 | 包体积 | 详情 → 基本信息 / 代码依赖分析 | 主包 <600K；pkgAi/pkgGif/pkgTools 显示为独立分包；总预览无「超过 2MB」提示 | 依赖分析面板截图 |
| A3 | 静态门禁复跑 | 命令行 `node .harness/changes/tune-coldstart-subpackage-20260915/coding/verify-subpackage.js` | ALL PASS（含 sitemap 33 条规则核验——4 处 GIF 手工补录是易错点） | 命令输出全文 |

## B. 页面可达性（阶段 8，真机）

| # | 场景 | 步骤 | 预期 | 证据 |
|---|---|---|---|---|
| B1 | 主包 9 页 | 首页点 compress/crop/convert/watermark/filter/splice/compare/idPhoto + 精选区 | 全部秒开（无分包下载等待），渲染正常 | 每页截图或录屏 |
| B2 | pkgAi 12 页 | 首页 AI 组逐个点开 | 全部可达；**首次进入无下载等待**（preloadRule 已预下载；前提：模拟首装状态，见「首装模拟」说明）| 抽 3 页截图（至少含 aiMatting/aiAvatar/aiChat） |
| B3 | pkgGif 5 页 | 创意玩法组点 makeGif/gifEditor/gifBatch + gifEditor 内「草稿管理」「导出报告」入口 | 可达；首次进入允许短暂 loading（分包按需下载，预期行为） | 截图 |
| B4 | pkgTools 7 页 | 基础处理组点 exif/similarity/formatRecommend/colorAnalysis/hiddenWatermark/imgToPdf/pdfToImage | 可达，同上 | 抽 3 页截图 |
| B5 | 包内互跳 | gifEditor ↔ makeGif ↔ gifBatch ↔ gifReport ↔ gifDrafts 互跳；gifDrafts「恢复草稿」带 `?restoreDraft=1` 进 gifEditor | 跳转正常、参数生效 | gifDrafts→gifEditor 截图 |

## C. 功能链路抽测（每条覆盖一种依赖形态）

| # | 场景 | 步骤 | 预期 | 证据 |
|---|---|---|---|---|
| C1 | 主包内链路（compress） | 选图 → 压缩 → 出图 | 成功；image-uploader 组件/compare-helper/image-process 正常 | 结果页截图 |
| C2 | 分包页→主包 utils（aiMatting） | 选图 → 抠图 | 成功；限流计数 inc（云控制台 rate_limit 文档 `*_matting_*` 今日 +1） | 结果图 + rate_limit 文档截图 |
| C3 | **分包内 utils + 懒加载（gifEditor 自适应导出）** | 编辑 GIF → 导出（走自适应调色板路径 buildGIFDiffAdaptive） | 导出成功——**此路径触发迁移后的懒加载 `require('../../utils/color-quantize.js')`**，是本次重构最易断的一环 | 导出 GIF 播放截图 |
| C4 | 迁移 piexif（exif） | 选含 EXIF 的 JPG → 读取 | 相机参数正常显示 | 截图 |
| C5 | 云函数链路不受影响（pdfToImage） | 上传 PDF → 转图 | 成功 | 截图 |
| C6 | 内容安全跨包（pkgAi 页） | 上传正常图（应过）+ 违规图（应拦，toast「图片可能包含违规内容」） | 正常图过、违规图拦 | 两次操作截图 |
| C7 | utils→主包两层 require（aiColorize） | 老照片上色：选黑白/旧照 → 上色 | 成功——触发 `pkgAi/utils/colorize-detect.js:10` 的 `require('../../utils/image-process')`（spec §4 手工修正行） | 结果图截图 |
| C8 | utils→主包两层 require（similarity） | 找重复图：选两张图 | 出相似度结果——触发 `pkgTools/utils/image-hash.js:17` 同类修正 | 结果截图 |
| C9 | utils→主包两层 require（formatRecommend） | 格式推荐：选图 → 分析 | 出推荐——触发 `pkgTools/utils/format-recommend.js:20` → 主包 color-quantize | 结果截图 |
| C10 | 跨包组件注入（aiAvatar） | AI百变头像：确认上传组件渲染正常（`usingComponents` 引主包 `/components/image-uploader`） | 组件 UI/选图/上传全部正常——跨分包组件注入的运行时证据 | 上传态截图 |

## D. 行为专项

| # | 场景 | 步骤 | 预期 | 证据 |
|---|---|---|---|---|
| D1 | preloadRule 生效 | **首装模拟**（见下）→ 首页 onLoad 后停 3 秒 → 进任一 AI 页 | 秒进无 loading | 录屏或体感记录 |
| D2 | 分享新路径（pkgAi） | pkgAi 任一页 → 分享给好友 → 点开卡片 | 落到该页（新路径 `/pkgAi/pages/...`） | 卡片打开截图 |
| D2b | 分享新路径（每包抽样） | pkgGif 一页 + pkgTools 一页 → 分享 → 打开 | 均落到对应页（24 处 path 逐页重写，抽样每包验证） | 两次卡片打开截图 |
| D3 | 老路径降级（可选，如有存量卡片） | 打开重构前分享的卡片 | 提示页面不存在/落首页（已知代价，非缺陷） | 截图 |
| D4 | 冷启动体感 | **首装模拟**后冷启动首页 | 明显不慢于线上版 | 体感 + 次日 We分析 P50 |

> **首装模拟（M2 修正，必读）**：杀进程**不清**微信的分包本地缓存——B2/D1/D4 若只在杀进程后测，会因暖缓存假通过。正确做法：微信里长按小程序（或 我-设置-通用-存储 附近入口）→ **删除该小程序** → 重新扫码预览进入，此时主包+分包全量重下，才等价于首装用户。
> **口径说明**：预览/体验版只能验证功能正确性；**冷启动耗时的正式结论只能来自发布后 We分析**（诊断日报/启动分析），预览版数据不作数。

## E. 数据侧观察（非阻塞，发布后 24-72h）

- We分析 → 性能 → 启动分析：冷启动 P50/P90 对比基线（1439.5ms / 360ms）
- 全局诊断日报：版本归因切到新版本号（建议 bump 5.1.0）
- 用户后台行动项（方案 B）：版本发布记录 / 启动漏斗下载-注入-渲染分段 / 新用户占比

## 通过标准
A 全过 + B 全过 + C 全过 + D1/D2 过（D3 可选）→ 阶段 8 通过；E 项不影响交付判定。
