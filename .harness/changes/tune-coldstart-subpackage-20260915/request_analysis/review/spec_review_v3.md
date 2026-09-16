# spec_review_v3（终审）

- 评审对象：`request_analysis/spec.md` + `tasks.md` 修改稿（针对 spec_review_v2 全部发现的修复）
- 评审方式：逐项 grep 核对 v2 修复落点 + 通读修改后全文查新引入问题 + 抽查 spec 引用的源码行号是否仍准确
- 评审日期：2026-09-15
- 上一轮结论：❌ 需修改（v2：N-1 Critical / N-2 / N-3 / M-7 残留）

## 结论：APPROVED ✅（4/4 已修，0 新问题，可进阶段 3 coding）

## 一、v2 未决发现逐项核验

### N-1（Critical）分包 utils→主包 require 层数 —— 已修 ✅

全文件 grep `\.\./\.\./\.\./` 与 `\.\./\.\./utils/` 两种模式交叉核验，结果：

**三层 `../../../` 全部剩余出现处（共 5 处），主语均为「页面」，层数正确，无一处套在 utils 文件上：**

| 位置 | 主语 | 判定 |
|---|---|---|
| spec.md:63 | 分包页面 require 主包 utils | ✓ 正确 |
| spec.md:64 | 页面在 `pkgX/pages/<name>/` 三层深 | ✓ 正确 |
| spec.md:65 | 「三层 `../../../` 是页面专属规则」（层级警示，非修正指令） | ✓ 正确 |
| spec.md:80（§5.3） | 分包页引用主包 5 件套 `../../utils/` → `../../../utils/` | ✓ 正确 |
| tasks.md:12（T2） | 分包页 require 修正（页面三层） | ✓ 正确 |

**utils 文件指向主包的修正处（实测 9 处，多于声称的 7 处，全部两层 `../../utils/`，无一遗漏无一错误）：**

| 位置 | 内容 | 判定 |
|---|---|---|
| spec.md:57（§3 color-quantize 行） | 两处引用改 `../../utils/color-quantize`，注明「utils 文件两层深，**不是**页面的三层规则」 | ✓ 已改两层 |
| spec.md:65（§4 新增层级说明） | 「被迁移 utils 在 `pkgX/utils/` 只有两层深…三层套到 utils 上会跳出项目根（评审 N-1 教训）」 | ✓ 新增且正确 |
| spec.md:69（§4 表 colorize-detect） | `../../utils/image-process` | ✓ |
| spec.md:70（§4 表 image-hash） | `../../utils/image-process` | ✓ |
| spec.md:71（§4 表 format-recommend） | `../../utils/color-quantize`（不带后缀，沿用原风格） | ✓ |
| spec.md:72（§4 表 gif-encoder） | `../../utils/color-quantize.js`（带 .js 后缀，沿用原风格） | ✓ |
| tasks.md:13（T2） | gif-encoder.js:20 → `../../utils/color-quantize.js`（utils 文件两层深） | ✓ |
| tasks.md:19（T3） | colorize-detect.js:10 → `../../utils/image-process`（utils 两层深） | ✓ |
| tasks.md:26（T4） | image-hash.js:17 / format-recommend.js:20 → 两层 | ✓ |

后缀风格区分（gif-encoder 带 `.js`、format-recommend 不带）在 §4 表格与 T2/T4 中均与源码原文一致，v2 要求的「沿用原风格」已落实。

**源码行号抽查（4/4 仍准确，非陈旧引用）**：`utils/gif-encoder.js:20` = `require('./color-quantize.js')`、`utils/format-recommend.js:20` = `require('./color-quantize')`、`utils/colorize-detect.js:10` = `require('./image-process')`、`utils/image-hash.js:17` = `require('./image-process')`。utils/ 目录实测 20 个 js 文件，与 spec 落位闭环口径（留主包 8 + 迁移 12 = 20）一致。

备注（不构成问题）：spec.md:57 的概述「两处引用改 `../../utils/color-quantize`」不带 `.js`，与 gif-encoder 原文风格（带后缀）不完全一致——但权威修正清单在 §4 表格与 T2（均精确带后缀），且小程序 require 对不带后缀形式同样可解析，无行为风险。

### N-2（Minor）§5.2「13 个文件」→ 12 个 —— 已修 ✅

spec.md:79 现为「`utils/piexif.js` 等 **12 个文件** → 各分包 `utils/`（pkgTools 5 个 + pkgGif 6 个 + pkgAi 1 个，见 §3；color-quantize 不迁）」。grep 全文无「13 个」残留。构成 5+6+1=12 与 §3 各包头（pkgTools 5 utils / pkgGif 6 utils / pkgAi 1 util）逐项对账一致。

### N-3（Minor）T2-T4 验证前缀口径 —— 已修 ✅（方案强于 v2 建议）

tasks.md:15（T2 验证）现为：「`grep -rn "require('./" pkgGif/utils/` 逐条确认目标同包或已改；**用 node 脚本解析 pkgGif/ 下全部 require 并核验目标文件存在**（替代前缀口径——分包页引本包 utils 与包内 utils 引主包同为 `../../utils/` 前缀，前缀 grep 无法区分合法性）；工具编译无错」。

- 括号内替换理由的路径推演实测成立：页面 `pkgX/pages/<n>/x.js` 上两层 = pkgX 根（→本包 utils）；utils `pkgX/utils/x.js` 上两层 = 项目根（→主包 utils）——两者字符串前缀同为 `../../utils/`，前缀 grep 确实无法区分。
- 「解析全部 require + 核验目标文件存在」比 v2 建议的「两类合法命中」文字口径更强：能同时捕获层数错误（跳出项目根）、漏改 `./xxx`、指向不存在模块的全部情况。
- T3:20、T4:27「验证同 T2（含 `require('./` 扫描）」按引用覆盖，无遗漏。

### M-7（Minor）§3 依据表述 —— 已修 ✅

- spec.md:52：「image-process.js（**14 页 + image-uploader 组件引用**，分包可 require 主包）」——与 v1 实测（14 页 + image-uploader.js:2）一致。
- spec.md:55：「upscale-local.js（**crop/aiUpscale/aiColorize** 引用）、saliency-detect.js（crop 引用）」——与 v1 实测（crop.js + aiUpscale.js:6 + aiColorize.js:6）一致。
- grep 全文无「15 页」残留。

## 二、新引入问题检查 —— 无 ✅

通读修改后 spec.md（122 行）与 tasks.md（37 行）全文：

1. **无残留错误层数**：`../../../` 仅存于页面语境 5 处（见 N-1 表），utils 语境零残留。
2. **无旧口径残留**：「13 个 / 15 页 / 32 个」全 grep 0 命中。
3. **无新矛盾**：§3:57、§4:64-65、§5.3、T2:12-13 的层级表述互相一致（页面三层 / utils 两层，且 §4:65 显式警示区别）；§5.2 的 12 与 §3 各包清单一致；T2/T3/T4 与 §4 修正表逐行对得上。
4. v1/v2 已修项无回退抽查：§3:45「4 页引用，gifDrafts 不直接用」、§3:56 id-photo-geometry、§3:58 image-uploader 绝对路径、§5.6/T5 带引号左边界 grep 模式、§7.2「33 个注册页面」均原样保持正确。

## 三、终审结论

v2 的 4 项未决发现全部修复到位且未引入新问题；spec 依赖图、修正清单、验证手段经三轮对抗核验均已闭环。**批准进入阶段 3（coding）**，按 `.harness/agents/application-owner.md` 流程与 tasks.md T1-T6 执行。
