# code_review_v1

- 评审对象：commit `0ee813a`（MERGE_BASE `d80aca2`），whole-change 模式
- 评审人：code-review agent（独立复跑全部验证，未采信 coding_report_v1.md 的自述证据）
- 日期：2026-09-16（北京）

## 结论：FAIL（Critical=0，Important=1）

唯一 Important：**8 个 `scripts/*.js` 测试脚本的路径适配只存在于工作区、未随 0ee813a 提交**——HEAD 上全部 8 个脚本 require 已不存在的 `../utils/gif-*.js`，一跑即崩。修复动作一行（补提交这 8 个文件），其余全部检查项通过；补提交后重审预计 PASS。

## 独立验证结果（每项：命令 + 输出摘要）

| # | 验证项 | 命令 | 结果 |
|---|---|---|---|
| 1 | 静态验证脚本复跑 | `node .harness/.../coding/verify-subpackage.js` | 复现 ALL PASS：35 JSON 合法；33 注册页（主 9+分 24）四件套齐全无孤儿；114 条 require 全解析；路由字面量 17 处非主包残留 0；sitemap 33 条规则未注册 0；preloadRule index→pkgAi(network=all) |
| 2 | 变更文件集 vs spec §5 | `git show 0ee813a --name-status` | 125 文件 = 9 个 .harness 工件 + app.json/sitemap.json/index.js(M) + 5 D（aiEnhance 四件套+placeholder.png）+ 24 页×4 + 12 utils 的 R/RM。与 §5 清单 1-8 逐条对应，无多改；**缺 scripts/（见 Important-1）** |
| 3 | RM 文件逐行核对（超出 6+4+3 抽样要求，全量 31 个 RM 全看） | `git show 0ee813a -M -- . ':(exclude).harness'` 提取全部 +/- 行 | 每个改动行均为两类之一：require 前缀 `../../utils/`→`../../../utils/`（或 utils 内部定点 4 处）、路由/分享 path `'/pages/x'`→`'/pkgX/pages/x'`。**零逻辑漂移**。抽样覆盖：pkgAi 12 页 js 全看、pkgGif 5 页 js 全看、pkgTools 7 页 js 全看、4 个被改写 utils（colorize-detect/gif-encoder/format-recommend/image-hash）、3 个被改写 wxml（gifBatch/gifEditor/makeGif，均为 navigator url） |
| 4a | wxml 静态资源引用 | grep `src="/`\|`url\(` 全部 wxml | 0 命中——无任何指向被删/被迁资源的绝对引用 |
| 4b | wxss @import / background:url | grep `@import`\|`url\(` 全部 wxss | 0 命中——app.wxss 不 @import 任何文件，页面 wxss 无 url() 资源（全部 R100 原样迁移） |
| 4c | usingComponents 相对路径 | grep `usingComponents` 全部 json | 全部为 `{}` 或绝对路径 `/components/image-uploader/image-uploader`（分包 5 页 + 主包 2 页）；**0 相对路径**。分包页经绝对路径引主包组件合法 |
| 4d | 动态路由旧路径假设 | grep `navigateBack\|getCurrentPages\|reLaunch\|switchTab` 全仓 js/wxml | **0 命中**（全仓无此类调用，不存在基于页面栈层级的旧路径假设）。分包页 navigateTo/redirectTo 仅 1 处（gifDrafts→gifEditor，已更新带包前缀） |
| 4e | images/ 资源与 placeholder.png | `git ls-tree d80aca2 -- images/` + grep `images/`、`placeholder` 全部 js/json/wxml/wxss | d80aca2 时 images/ **只有 placeholder.png 一个文件**，删除后目录消失；代码中 0 处引用 `images/`，`placeholder` 命中全为 CSS 类名/input placeholder 属性/cloud-secret `_isPlaceholder`（无关）。删除安全 |
| 4f | 全仓旧路径残留（带引号左边界） | grep `['"]/pages/(24 个迁移页名\|aiEnhance)` js/json/wxml/wxss | **0 命中**。index.js 35 处 url = 27 已改 + 8 主包页（idPhoto/compress/crop/convert/watermark/filter/splice/compare，正确保留）；分包 23 个含 onShareAppMessage 的页面 23 处 path 全部已改，0 遗漏 |
| 4g | scripts/ 路径适配 | `git status --short` + `git diff d80aca2 0ee813a -- scripts/` + grep | **发现 Important-1**：8 个脚本工作区已改为 `pkgGif/utils/...` 且改动纯路径，但 commit 不含 scripts/（diff 为空），HEAD 版本仍指 `../utils/gif-*.js`（已不存在） |
| 4h | 根 utils 完整性 | `ls utils/ pkg*/utils/` | 根 utils 恰为 §3 留主包 8 件（analytics/color-quantize/compare-helper/content-check/id-photo-geometry/image-process/saliency-detect/upscale-local），被迁 12 件无残留；pkgAi 1 + pkgGif 6 + pkgTools 5 与 spec 一致 |
| 4i | 被迁 utils 内部 require | grep `require(` pkg*/utils/ | 共 6 条，逐条对上 spec §4 表：colorize-detect:10 / gif-encoder:20 / format-recommend:20 / image-hash:17 → `../../utils/`（两层，指向主包，正确）；gif-compress:19,20 `./`（同包，不动，正确）；其余 7 个被迁 utils 无 require（R100 自洽） |
| 4j | 体积（du 复核报告口径） | `du -sk` | pages 385K + utils 96K + components 33K ≈ **主包 ~534K**（<600K 目标）；pkgAi 412K / pkgGif 325K / pkgTools 379K，均 <2MB；preload pkgAi 412K <2MB。与 coding_report_v1 数值一致 |
| 4k | app.json 结构完整性 | 读 app.json | `pages[0]` 仍为 `pages/index/index`（入口不变）；`lazyCodeLoading:"requiredComponents"`、`sitemapLocation` 保留；subpackages 3 个 root+相对 pages 形式合法；preloadRule 键为主包页、packages=["pkgAi"]、network:"all" 合法 |
| 4l | 输入 patch 完整性 | patch 文件列表 vs `git show --name-only` | full_diff.patch 125 个 diff 条目与 commit 文件集一致（patch 为 no-rename 形式，a/ 侧用旧路径，内容等价） |
| 4m | 红线声明验证（spec §2 "不涉及"） | name-status + diff 内容 | commit 0 文件位于 cloudfunctions/（云函数三件套不动 ✓）；diff 中无 SECRET_ID/SECRET_KEY 类内容（密钥不涉及 ✓）；`utils/content-check.js` 本体零改动，分包页仅改 require 前缀、guardImage/guardText 分层不变（内容安全 ✓）；全部 wxss R100 零内容改动（设计 token ✓）。四项声明全部成立 |

## 发现

### Critical（0）

无。

### Important（1）

**I-1 scripts/ 的 8 个测试脚本路径适配未提交，HEAD 上全部损坏**

- 证据：
  - `git diff d80aca2 0ee813a --stat -- scripts/` 输出为空（commit 不含 scripts）；
  - `git status --short`：` M scripts/gif-adaptive-test.js`、`gif-adv-test.js`、`gif-bench.js`、`gif-decoder.test.js`、`gif-engine-test.js`、`gif-fuzz.js`、`gif-report-test.js`、`gif-stroke-undo-test.js` 共 8 个已跟踪文件处于已修改未提交状态；
  - HEAD 版本（`git show HEAD:scripts/gif-bench.js` 第 11-12 行）仍为 `require(path.join(__dirname, '..', 'utils', 'gif-decoder.js'))` 等，而 `utils/gif-*.js` 已全部迁至 `pkgGif/utils/`——HEAD 上任一脚本 `node scripts/gif-*.js` 即 `Cannot find module`；
  - 工作区版已正确改为 `'..', 'pkgGif', 'utils', ...`（改动纯路径，8 个文件逐行核对无逻辑变化），即修复已完成但停留在未提交状态；
  - `coding_report_v1.md` 的 git 变更统计（"77 R + 31 RM + 3 M + 5 D"）未提及 scripts，自述证据漏报；
  - `verify-subpackage.js` 的扫描范围（第 62-70 行 CODE 列表）不含 scripts/，故 ALL PASS 无法发现此问题——验证盲区恰好放过了唯一真实缺陷。
- 影响评估：`project.config.json` packOptions.ignore 含 `scripts`，不打进小程序包，**用户运行时/包体零影响**；但这 8 个脚本是本项目唯一的回归/交叉验证工具（GIF LZW 编码器口碑库交叉验证、撤销栈语义同构测试，见 CLAUDE.md 记忆条目 gif-lzw-width-rule-gotcha / page-logic-homologous-mock-node-test），提交版本的仓库丢失这层安全网。
- 定级理由：非 Critical（不破坏线上功能、不触红线）；但被评审的提交本身不完整——同一变更的必要配套改掉了一半，必须补齐才算完成 → Important。
- 修复：`git add scripts/ && git commit --amend`（或追加一个小 commit）。补提交后本项清零，其余检查已全过，重审可直接 PASS。

### Minor（1）

**M-1 迁移页 js 首行路径注释过时（24 个文件）**

- 证据：`pkgAi/pages/aiAvatar/aiAvatar.js:1` 仍为 `// pages/aiAvatar/aiAvatar.js`；grep `^// pages/` 在 pkgAi/pkgGif/pkgTools 页面 js 命中 24 个文件。文件实际已位于 `pkgX/pages/...`。
- 影响：零行为影响，纯注释陈旧。且本次评审要求"只改路径不改逻辑"，注释保持原样反而是迁移保真的体现；列出仅供后续顺手清理，不阻塞。

## spec 合规对照表

| spec 条目 | 要求 | 核对结果 |
|---|---|---|
| §3 主包 9 页 | index + compress/crop/convert/watermark/filter/splice/compare + idPhoto | ✅ app.json pages 恰为这 9 页，入口顺序不变 |
| §3 pkgAi 12 页 + colorize-detect | 12 AI 页迁入，仅 aiColorize 引用的 colorize-detect 随包 | ✅ name-status 12 页×4 + R097 utils/colorize-detect.js |
| §3 pkgGif 5 页 + 6 utils | makeGif/gifEditor/gifBatch/gifReport/gifDrafts + gif-encoder/decoder/report/compress/effects/frame-ops | ✅ 5 页×4 + 6 utils 全迁；gif-compress 同包 require 不动（§4 表） |
| §3 pkgTools 7 页 + 5 utils | exif/similarity/formatRecommend/colorAnalysis/hiddenWatermark/pdfToImage/imgToPdf + piexif/exif-tags/image-hash/format-recommend/hidden-watermark | ✅ 7 页×4 + 5 utils 全迁 |
| §3 留主包清单 | image-process/analytics/content-check/compare-helper/upscale-local/saliency-detect/id-photo-geometry/**color-quantize**/components/image-uploader | ✅ 根 utils 恰为 8 件（见验证 4h）；color-quantize 留主包、两处跨分包引用均为两层 `../../utils/color-quantize`（gif-encoder:20 带 .js、format-recommend:20 不带，与 §4 表逐字一致）；image-uploader 未动、引用全为绝对路径 |
| §4 层级规则 | 页面三层 `../../../utils/` 引主包；utils 两层 `../../utils/`；同包 `../../utils/x` 不变；禁主包反向引分包 | ✅ 24 页全部主包引用均为三层（含 aiColorize:6 带 // 注释 的 upscale-local，即报告 +1 处）；被迁 utils 6 条内部 require 逐条对表；全仓无主包→分包 require（反向依赖 grep 0） |
| §4 两种 require 形式 | 带/不带 .js 后缀都要查 | ✅ 验证 4i 两种均覆盖（piexif.js 带、image-hash 不带等） |
| §5.1-2 git mv 页面与 utils | 24 页 + 12 utils | ✅ R/R100 记录齐全（77 R + RM） |
| §5.3 require 修正 | 主包 utils 引用改三层 | ✅ 报告称 56 处（spec 预估 55+1 注释行），全量逐行核对未见漏改（require 解析 114 条 0 失败 + 我方独立 grep） |
| §5.4 app.json | 9 页 + 3 subpackages + preloadRule(all→pkgAi) | ✅（验证 4k） |
| §5.5 index.js url 更新 | 约 26 处 | ✅ 实际 27 处（含 hotScenes 6 处），spec 自身估算值，非偏差 |
| §5.6 旧路径清扫 0 残留 | 带引号左边界 grep | ✅ 独立 grep 0 命中（验证 4f，模式同 spec 并补 aiEnhance） |
| §5.7 usingComponents 全绝对路径 | 迁移页 json 无需改 | ✅ 全仓 0 相对路径组件引用（验证 4c） |
| §5.8 删除 aiEnhance + placeholder.png | 两项死重 | ✅ 5 D；全仓 0 引用残留（验证 4e） |
| §7.1 编译 0 error + 主包 <600K | 开发者工具 | ⚠️ 静态层全部通过（114 require 解析、无悬空引用）、du 主包 ~534K 达标；官方编译器验证属阶段 7 用户操作，编码报告已如实列为未尽事项——非代码缺陷 |
| §7.2 33 页可达 | 注册数不变、真机可达 | ✅ 注册 33（9+24）与迁移前页数一致、四件套齐全、磁盘无孤儿、入口页不变；真机可达性属阶段 8，待用户执行 |
| §7.3 五条链路抽测 | compress/aiMatting/gifEditor/exif/pdfToImage | ✅ 静态依赖层全部可解析：aiMatting→主包 utils 三层、gifEditor→本包 6 utils、exif→pkgTools/utils/piexif、pdfToImage→纯云函数链路 0 路径耦合、compress 未动；真机功能验证属阶段 8 |
| §7.4 数据侧观察 | We分析对比 | 按评审范围排除，不计入 |

## 结论重申

FAIL，Critical=0 / Important=1（scripts/ 适配未提交，I-1）/ Minor=1（24 处过时头注释，M-1）。修复 I-1 仅需把工作区已完成的 8 个 scripts 改动补进提交；其余静态验证全部独立复跑通过，分包结构、require 层级、路由/分享/sitemap、资源引用、红线声明均与 spec 一致。
