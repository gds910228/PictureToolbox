# test_review_v1：阶段 6 验证用例清单评审

- 日期：2026-09-16（北京）
- 评审对象：`unit_test/test_report.md`（手动验证用例清单，无测试框架的适配形态）
- 评审输入：`request_analysis/spec.md`（§3/§4/§7）、`coding/coding_report_v1.md`、实际代码核对（app.json / sitemap.json / 各分包 require 现场逐一 grep 验证）
- 结论：**❌ REVISE —— 修订后通过**。清单骨架与 spec §7 对齐良好（C1–C5 与 §7.3 五链路一一对应，A↔§7.1、B↔§7.2、E↔§7.4 均映射到位），C3 抓住懒加载 require 这一最易断点值得肯定；但存在 **3 项 Major**：三种 require 形态中「utils→主包」4 处仅覆盖 1 处、preloadRule/冷启动验证被微信分包缓存污染（杀进程不清缓存，D1/D4 现状会假通过）、跨分包自定义组件零运行时证据。补 6 条新用例 + 改写 2 条 + 2 项证据规则修订后即可通过，无需全量重评。

## 一、代码核对基础（评审前实测，非转述）

| 事实 | 来源 |
|---|---|
| app.json：9 页主包 + 3 分包（pkgAi 12 / pkgGif 5 / pkgTools 7）+ preloadRule `index → pkgAi, network:all` | app.json 实读 |
| sitemap：33 条规则，前缀覆盖 pages/pkgAi/pkgGif/pkgTools | sitemap.json 实读 |
| utils→主包 require 共 **4 处**：`pkgAi/utils/colorize-detect.js:10`、`pkgTools/utils/image-hash.js:17`、`pkgTools/utils/format-recommend.js:20`、`pkgGif/utils/gif-encoder.js:20`（仅此 1 处为函数体内懒加载，其余 3 处为文件顶层） | grep 实测 |
| 引用方均为页面顶层 require（aiColorize.js:7 / similarity.js:8 / formatRecommend.js:5 / gifEditor.js:7） | grep 实测 |
| aiMatting.json `usingComponents` 为**空**——C2 不经过 image-uploader 组件；aiAvatar.json 用 `/components/image-uploader/...` 绝对路径 | json 实读 |
| aiMatting FEATURE_KEY = `'matting'`，C2 的 `*_matting_*` 文档证据描述准确 | cloudfunctions/aiMatting/index.js:22 |
| gifDrafts 恢复草稿跳 `/pkgGif/pages/gifEditor/gifEditor?restoreDraft=1`，B5 描述准确 | pkgGif/pages/gifDrafts/gifDrafts.js:118 |

## 二、发现分级

### Major（阻塞，须修订）

**M1：「utils→主包两层」require 形态 4 处仅覆盖 1 处**
本次重构三种 require 形态的用例覆盖：

| 形态 | 覆盖情况 |
|---|---|
| 页面→主包三层（`../../../`） | ✅ C2 + 所有分包页顶层 analytics require，充分 |
| 页面→包内两层（`../../`） | ✅ C3（gifEditor→gif-encoder 等 6 个）、C4（exif→piexif） |
| utils→主包两层（`../../`） | ⚠️ **仅 C3 触发 gif-encoder.js:20 懒加载 1 处**；colorize-detect / image-hash / format-recommend 三处无任何功能用例触发 |
| 懒加载 require | ✅ C3（好设计，本次最易断点） |

这 3 处正是 spec §4「评审 Important 修正」手工定点改的行——上一轮评审的 N-1 教训（utils 两层 vs 页面三层混淆）恰好发生在这类位置，是人工错误密度最高的改动面。缓解因素：三处均为顶层 require、引用页也是顶层引入，路径写错会在页面加载时抛错（编译期也可能告警），但 B2/B4 的证据标准是「抽 3 页截图」——抽样未钉死，这 3 页完全可能没被抽到。**必须补 3 条功能链路用例**（见 §四 C7–C9，各约 1 分钟成本），或至少把这 3 页钉死进 B 抽样并叠加 console 清洁规则（M3/I3 联动）——但功能链路是更硬的证据。

**M2：D1/B2/D4 的「首次进入」「冷启动」验证被微信分包缓存污染——杀进程不够**
微信对已下载的分包做本地缓存，**杀进程不清缓存**。真机预览中一旦曾进过 pkgAi（哪怕上一轮 B 用例跑过一次），后续「杀进程→冷启动→进 AI 页秒开」走的是缓存而非 preloadRule，**preloadRule 即使配置无效也会假通过**。同理 D4：杀进程后是「暖缓存冷启动」，而 spec §1 的根因恰是**首装用户全量下载主包**——暖缓存冷启动根本测不出本次优化的目标收益，D4 现状既不能证伪也不能证实。修订：
- D1/B2 前置改为「**最近使用列表长按→删除小程序**」（清本地缓存与 storage，模拟首装）→ 重新扫码进入。注意：删除会清 gifDrafts 草稿等 storage，测试设备先备份。
- D4 拆两条：(a) 首装模拟（删除小程序→重进）对比线上旧版首装体感；(b) 二次冷启动（杀进程）不劣化。并在用例里注明预览/体验版含调试开销、未走发布压缩链路，体感仅方向性，正式结论以 E 的 We分析 为准（We分析只统计正式版）。

**M3：跨分包自定义组件（主包 image-uploader 注入分包页）零运行时证据**
spec §3/§5.7 的关键假设是「绝对路径 `/components/...` 跨包引用合法、零改动」。现状：C1 compress 只覆盖主包内用法；C2 aiMatting 的 `usingComponents` 为空（实测），恰好绕开组件。6 个用它的分包页（aiAvatar/aiOutpaint/aiStyle/aiTextToImage 等）无任何 C 级链路。补 1 条分包页带 image-uploader 的选图链路（建议 aiAvatar，见 C10），或钉死 B2 抽样必含 aiAvatar 且叠加 console 清洁规则。

### Important（应修订）

**I1：sitemap 无专属用例**
coding_report 的 sitemap 改动 = 20 处脚本自动 + **4 处手工补录**（gifEditor/gifBatch/gifReport/gifDrafts）——手工处最易错，而 test_report 对 sitemap 零提及（本项目 6 月刚做过搜索爬虫可发现性优化，commit 0cc854d，sitemap 回归有实际业务价值）。最低成本：阶段 7 门禁追加重跑 `coding/verify-subpackage.js` 的 sitemap 段（33 条规则、未注册 0、四前缀齐全）作为 A3 证据；可选加 mp 后台「页面收录」抽查新路径。

**I2：分享路径 24 处逐页重写，D2 只测 pkgAi 单页**
分享 path 是逐页散点改动，单页前缀拼错只在该页的分享卡上降级（落首页），不会被任何静态或单点用例捕获。补每包至少 1 页的分享打开抽样（D2b：pkgGif gifEditor、pkgTools exif）。

**I3：缺全局「console 清洁」证据规则**
require 断裂不必然白屏——函数体内懒加载（如 gif-encoder.js:20 恰是）、try 包裹、或仅部分功能挂掉时，唯一线索是 console 报错。建议：真机全程开调试模式（vConsole），「所有 B/C/D 用例执行期间无 `Module ... is not defined` / `Cannot find module` 类报错」写入通用证据与通过标准。这是对全清单的免费加固。

### Minor（建议）

- **N1**：C6「违规图」素材来源未指定，真机难复现——指定可复用测试素材，或标注 best-effort（若无法稳定构造，允许降级为仅验证「正常图通过」侧）。
- **N2**：体验版 vs 正式版差异未提示——除 M2 所述性能口径外，还应提示：正式结论只能来自 E（We分析仅正式版），且 E 建议的版本 bump（5.1.0）应前置为发布 checklist 项，否则全局诊断日报的版本归因又会失真（spec §1 的教训）。
- **N3**：B2/B3/B4「抽 3 页」未钉死样本页（与 M1/M3 联动，抽样须含风险页）。
- **N4**：D1 证据「录屏或体感记录」中「体感」不满足清单自己声明的证据铁律（首行「证据缺一不可」）；预下载请求可开 vConsole 网络面板佐证。
- **N5**：preload 失败是静默降级（不报错、按需下载兜底，页面仍可用）——D1 判定的是性能不是可用性，可在预期里写明，避免误判。

## 三、与 spec §7 验收标准对齐检查

| spec §7 | 清单映射 | 判定 |
|---|---|---|
| 7.1 编译 0 error + 主包 <600K | A1/A2 | ✅ 对齐（A2 还加了 2MB 总量提示检查，超出 spec，好） |
| 7.2 33 页真机全部可达 | B1–B4（步骤逐页点开） | ✅ 对齐；但证据「抽 3 页」使 33 页可达为弱保证（N3/I3 缓解） |
| 7.3 五链路 compress/aiMatting/gifEditor/exif/pdfToImage | C1–C5 一一对应 | ✅ 对齐，且 C6 额外加餐 |
| 7.4 We分析次日观察（非阻塞） | E | ✅ 对齐，通过标准正确将其排除在交付判定外 |

无脱节。清单相对 spec 的增量（C6、E 的漏斗/新用户占比）均合理。

## 四、补充用例建议（可直接并入 test_report）

| # | 场景 | 步骤 | 预期 | 证据 |
|---|---|---|---|---|
| C7 | utils→主包（pkgAi）：aiColorize 灰度检测 | 进 aiColorize → 上传一张明显黑白/灰度照片 → 触发检测/上色 | 链路成功，灰度判定正常——触发 `pkgAi/utils/colorize-detect.js:10` → 主包 image-process（utils 两层形态） | 结果截图 |
| C8 | utils→主包（pkgTools）：similarity 找重复 | 进 similarity → 选 2 张近似图 → 找重复 | 相似度正常输出——触发 `pkgTools/utils/image-hash.js:17` → 主包 image-process | 结果截图 |
| C9 | utils→主包（pkgTools）：formatRecommend | 进 formatRecommend → 选 1 图 → 生成格式推荐 | 推荐正常——触发 `pkgTools/utils/format-recommend.js:20` → 主包 color-quantize | 结果截图 |
| C10 | 跨分包自定义组件 | 进 aiAvatar → image-uploader 选图上传 | 组件正常渲染、选图/上传成功（主包组件绝对路径注入分包页，本次零改动假设的运行时验证） | 截图 |
| A3 | sitemap 静态门禁（阶段 7） | 重跑 `node coding/verify-subpackage.js`（sitemap 段） | 33 条规则、未注册 0、前缀含 pages/pkgAi/pkgGif/pkgTools；可选 mp 后台页面收录抽查 | 脚本输出截图 |
| D2b | 分享路径每包抽样 | pkgGif gifEditor、pkgTools exif 各分享 1 张 → 打开卡片 | 均落到对应新路径页 | 卡片打开截图 |

**改写 2 条：**
- **D1（改）**：前置「长按最近使用→删除小程序（模拟首装，先备份草稿）」→ 扫码进入 → 开调试模式 → 首页停留 ≥5s → 进任一 AI 页。预期：无分包下载 loading；预下载失败为静默降级（不报错）；证据：录屏（含 vConsole 网络面板），删除「体感记录」。
- **D4（改，拆两条）**：(a) 首装模拟（删除小程序→重进）对比线上旧版首装，方向性验证优化收益；(b) 杀进程二次冷启动不劣化。注明：预览/体验版与正式版口径差异，正式结论以 E 的 We分析 为准；发布前确认 bump 5.1.0。

**证据规则修订 2 项：**
1. B2/B3/B4 抽样钉死：pkgAi 必含 aiAvatar + aiColorize；pkgTools 必含 similarity + formatRecommend（+ hiddenWatermark）。
2. 通过标准追加：全程真机开调试模式，B/C/D 执行期间 vConsole 无模块解析类报错。

## 五、修订后通过标准（建议替换原文）

A 全过（含 A3）+ B 全过（抽样钉死 + console 清洁）+ C 全过（C1–C10）+ D1（首装口径）/D2/D2b 过（D3 可选）+ D4 按新口径执行并留档 → 阶段 8 通过；E 项不影响交付判定，但版本 bump 5.1.0 前置为发布 checklist。

## 六、结论重述

**❌ REVISE**：3 Major（M1 utils→主包 require 覆盖 3/4 缺口、M2 缓存污染致 D1/D4 假通过风险、M3 跨包组件零运行时证据）+ 3 Important + 5 Minor。补 **6 条新用例**（C7–C10、A3、D2b）、改写 **2 条**（D1/D4）、修订 **2 项证据规则**后通过；修订为增量性质，原清单其余部分维持原判。
