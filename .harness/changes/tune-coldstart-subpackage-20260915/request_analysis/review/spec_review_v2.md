# spec_review_v2（复审）

- 评审对象：`request_analysis/spec.md` + `tasks.md` 修改稿（针对 spec_review_v1 全部发现的修复）
- 评审方式：逐项核对 v1 发现的修复落点 + 对修改新增内容（§3:57 / §4 表格 / §5.6 / T2-T5）做对抗性实测——行号对码、grep 全扫、路径推演
- 评审日期：2026-09-15
- 上一轮结论：❌ 需修改（v1：C-1 / I-2 / I-3 / M-4~M-8）

## 结论：❌ 需修改（仅 1 项阻塞：N-1 路径层数错误，30 秒可改完）

v1 的 8 项发现中 7 项已正确修复、1 项 Minor 残留（M-7，不阻塞）；但本次修改**引入 1 个 Critical 新问题**：§3/§4/tasks 中被迁移 utils 指向主包的修正路径全部写成三层 `../../../utils/`，正确应为两层 `../../utils/`——4 处修正指令 4 处全错。修复该层数 + 两个 Minor 后即可进编码，无需三轮评审。

## 一、v1 发现逐项修复核对

| v1 编号 | 内容 | v2 修复落点 | 核对结果 | 状态 |
|---|---|---|---|---|
| C-1 | color-quantize 跨分包非法依赖 | spec §3:57 移回「留主包」+ 两处引用列入修正；tasks T2:13、T4:24 同步 | 落位决策正确（留主包 7.8K，pkgTools 迁移清单已移除，留主包清单 8+迁移 12=20/20 与 utils 目录闭环）；**但两处引用的修正目标路径层数错**（→N-1） | 已修，修复内容有错（N-1） |
| I-2 | 被迁移 utils 内部 require 修正缺失 | spec §4 新增逐处修正表（5 行）；tasks T2-T4 加 `require('./` 全扫验证 | 行号 5/5 实测全对（见下节抽查）；本轮全扫 utils→utils require 共 10 处：须改 4 处全在表格内、同包不变 1 处已列、留主包互引 5 处确不需动——**表格完备无漏列**；**但 4 处须改项的目标路径层数全错**（→N-1） | 已修，修复内容有错（N-1） |
| I-3 | T5 grep 假阳性 | spec §5.6、tasks T5 改带引号左边界模式 `['\"]/pages/(ai[A-Z]\|gif\|...)`，注明裸模式禁用 | 模式实测推演正确：新路径 `/pkgAi/pages/aiXxx` 中 `/pages/` 左邻是字母非引号，不误报；本轮补查全仓**无反引号模板串形式**的 `/pages/` 路径（`` `/pages/ `` 0 命中），模式无假阴性缺口；「app.json 注释除外」错误表述已删 | ✅ 已修 |
| M-4 | 32 vs 33 算术错 | §7.2 | 「33 个注册页面（app.json 现有 33 页不变；aiEnhance 本就未注册，删除不影响注册数）」——正确且自洽 | ✅ 已修 |
| M-5 | id-photo-geometry 缺列 | §3:56 | 已明确留主包（idPhoto 引用，idPhoto 留主包）；清单闭环验证通过（见 C-1 行） | ✅ 已修 |
| M-6 | gif utils「5 页引用」不准 | §3:45 | 「仅被本包 4 页引用：makeGif/gifBatch/gifEditor/gifReport，gifDrafts 不直接用」——与 v1 实测一致 | ✅ 已修 |
| M-7 | 依据表述不完整（image-process「15 页引用」实为 14 页+1 组件；upscale-local 括号漏 aiUpscale/aiColorize） | — | §3:52 仍写「15 页引用」、§3:54 upscale-local 仍只标「crop 引用」。结论不受影响（§5.3 五件套修正清单是对的），但误导性表述原样残留 | ⚠️ 未修（Minor，不阻塞） |
| M-8 | components/image-uploader 未提及 | §3:58 + §5.7 + tasks T5 | 「留主包，绝对路径 `/components/...`，零改动」+ 编码时 grep 复核相对路径形式——说明准确，复核项到位 | ✅ 已修 |

v1 附带的建议级事项（T2 括号列举「image-process/analytics/content-check 等」与 §5.3 五件套不完全一致）：tasks T2:12 原样保留，「等」字 + §5.3 权威清单兜底，维持建议级不阻塞。

## 二、新引入问题

### N-1（Critical，本次唯一阻塞项）：分包 utils → 主包 utils 的修正路径层数全部写错——`../../../` 应为 `../../`

**事实**：spec §3:57（两处）、§4 表格 4 行（colorize-detect / image-hash / format-recommend / gif-encoder）、tasks T2:13、T3:19、T4:26，凡是被迁移 **utils 文件**指向主包的 require，目标路径一律写 `../../../utils/...`。

**推演**（require 相对路径相对当前文件，与现网代码一致，如 `pages/exif/exif.js` 的 `../../utils/piexif.js`）：

| 文件位置 | 目录深度 | 跳到项目根 | 例 |
|---|---|---|---|
| 分包页面 `pkgX/pages/<name>/<name>.js` | 3 层 | `../../../` ✓（spec §4:64 的规则，主语是「页面」，正确） | 页面引主包 `../../../utils/image-process` ✓ |
| 分包 utils `pkgX/utils/<file>.js` | 2 层 | `../../` | utils 引主包应为 `../../utils/image-process`；写成 `../../../utils/...` = `pkgX/utils/` 上跳 3 层 = **项目根之外**，模块不存在 |

**后果**：照 spec 编码，4 处修正（gif-encoder.js:20、format-recommend.js:20、colorize-detect.js:10、image-hash.js:17）全部指向不存在的路径，编译即报 module not found——恰是本轮 C-1+I-2 修复的核心交付物，4/4 全错，且 spec §4:64 自己写对的三层规则（限页面）与表格里 utils 的三层用法自相矛盾。v1 建议原文即为两层（`../../utils/color-quantize`），修改时被误「统一」成三层。

**修复**：把上述 7 处位置的 `../../../utils/` 改为 `../../utils/`（**仅限 utils 文件内的引用**；页面引用主包仍三层不动）。gif-encoder 行保留 `.js` 后缀、format-recommend 行不带后缀（各自沿用原风格，v2 表格已区分，保持即可）。

### N-2（Minor）：§5.2「utils/piexif.js 等 13 个文件」应为 12 个

color-quantize 移回主包后，迁移清单为 pkgAi 1 + pkgGif 6 + pkgTools 5 = **12**。13 是 v1 旧口径残留。§3 各包清单本身正确，编码按 §3 走不会错，仅数字失实。

### N-3（Minor）：T2-T4 验证 grep 的期望口径不精确

T2 验证写 `grep -rn "require('../../utils/" pkgGif/` 「仅剩指向本包 utils 的」。但按 N-1 修正后的正确路径，**分包 utils 文件引主包也是 `require('../../utils/` 前缀**（gif-encoder/colorize-detect/image-hash/format-recommend 共 4 处），会被该 grep 命中且目标在主包——按现口径执行会出 4 处「假异常」。期望口径应改为：「命中项分两类均为合法——页面文件的 `../../utils/` 指本包 utils；utils 文件的 `../../utils/` 指主包 utils（即 §4 修正表 4 项）。两类之外无残留」。（若不修 N-1 而照三层执行，该 grep 反而抓不到这 4 处——又一层数错的佐证。）

## 三、抽查证据（行号引用 vs 实际代码，5/5 一致）

- `utils/gif-encoder.js:20` → `_medianCut = require('./color-quantize.js').medianCut;` ✓（懒加载，§4 表格「:20」准确）
- `utils/format-recommend.js:20` → `const { medianCut } = require('./color-quantize');` ✓（不带 .js 后缀，表格区分正确）
- `utils/colorize-detect.js:10` → `require('./image-process')` ✓
- `utils/image-hash.js:17` → `require('./image-process')` ✓
- `utils/gif-compress.js:19,20` → `./gif-encoder.js` / `./gif-frame-ops.js` ✓（同包 pkgGif，标「不变」正确）
- utils→utils require 全仓实扫（`require\('\./` in utils/）共 10 处：须改 4 处（上表）+ 同包 2 处（gif-compress）+ 留主包互引 4 处（upscale-local.js:11 / saliency-detect.js:16 / image-process.js:571 / content-check.js:19）——与 §4 表格 + 留主包清单完全对账，无漏网
- 模板串路径 `` `/pages/ `` 全仓 0 命中 → §5.6 模式（`['\"]` 左边界，不含反引号）无假阴性缺口

## 四、建议

1. （必须，N-1）spec §3:57、§4 表格 4 行、tasks T2:13 / T3:19 / T4:26：utils 文件内的 `../../../utils/` 全部改 `../../utils/`。页面三层规则（§4:64、§5.3、T2「`../../` → `../../../`」）不动。
2. （必须随 1，N-3）T2-T4 验证口径改为「两类合法命中（页面→本包 utils、分包 utils→主包 utils）之外无残留」。
3. （建议，N-2）§5.2「13 个」改「12 个」；（M-7）§3:52「15 页引用」改「14 页 + image-uploader 组件」、§3:54 upscale-local 补「+ aiUpscale/aiColorize（分包页，§5.3 已列）」。
4. 修完 N-1 即可进阶段 3（coding），无需三轮全量评审——本轮已对全部修改落点实测核清，剩余仅机械性路径/数字修订。
