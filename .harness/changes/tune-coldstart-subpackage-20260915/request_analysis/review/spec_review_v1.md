# spec_review_v1

- 评审对象：`request_analysis/spec.md` + `tasks.md`（tune-coldstart-subpackage-20260915）
- 评审方式：对抗性验证——所有关键声明独立 grep/读码复核，不采信 spec 自洽叙述
- 评审日期：2026-09-15

## 结论：❌ 需修改

方案骨架（三分包分组、preloadRule、utils 随页迁移、死重清理、硬约束隔离）全部经得起对抗验证，页面落位 33/33 无遗漏；但依赖图存在 **1 个 Critical 破绽**（color-quantize 落位造成分包间非法 require）和 **2 个 Important 缺失**（被迁移 utils 的内部 require 修正缺失、T5 残留验证 grep 假阳性失效）。修改量小，改完可直接进编码。

## 事实核查结果（spec 声明 vs 实际 grep）

| # | spec 声明 | 核查结果 | 判定 |
|---|---|---|---|
| 1 | §1「33 个注册页面全部在主包」 | app.json `pages[]` 恰 33 项，无 subpackages/preloadRule | ✅ 属实 |
| 2 | §3 主包 9 页（index+compress/crop/convert/watermark/filter/splice/compare/idPhoto） | 与 app.json 逐项对照，9+12+5+7=33，无漏页无多页 | ✅ 属实 |
| 3 | §3 colorize-detect 仅 aiColorize 引用 → 迁 pkgAi | 全仓唯一引用 `pages/aiColorize/aiColorize.js:7` | ✅ 属实 |
| 4 | §3 piexif 仅被 pages/exif 和 exif-tags 引用 | `pages/exif/exif.js:10` `require('../../utils/piexif.js')`（带后缀）；`utils/exif-tags.js:2-3` 仅注释提及、**无 require** | ✅ 属实 |
| 5 | §3 exif-tags 迁 pkgTools | 唯一引用 `pages/exif/exif.js:11`（带 `.js` 后缀） | ✅ 属实 |
| 6 | §3 gif-* 6 文件「仅被这 5 页引用」 | 实际仅 **4 页**引用（makeGif/gifEditor/gifBatch/gifReport）；**gifDrafts 不引用任何 gif util**（只 require analytics）。落位不受影响 | ⚠️ 表述不准（Minor-6） |
| 7 | §3 color-quantize 仅 colorAnalysis 用 → 迁 pkgTools | 页面层面属实（`colorAnalysis.js:5` 唯一页面引用）；**但 utils 层面另有两处**：`utils/format-recommend.js:20`（同包，没问题）和 `utils/gif-encoder.js:20`（**跨包，非法**，见 Critical-1） | ❌ 破绽（Critical-1） |
| 8 | §3 image-hash / format-recommend / hidden-watermark 各仅对应页引用 | `similarity.js:8` / `formatRecommend.js:5` / `hiddenWatermark.js:6` 唯一引用，均随页同包 | ✅ 属实 |
| 9 | §3 compare-helper「主包 4 页 + pkgAi 多页」留主包 | 主包 compress/watermark/filter/compare 4 页 + pkgAi 7 页（aiAvatar/aiMatting/aiEraser/aiColorize/aiStyle/aiUpscale/aiOutpaint）引用 → 必须留主包，正确 | ✅ 属实 |
| 10 | §3 upscale-local（crop 引用）/ saliency-detect（crop 引用）留主包 | crop.js:9,10 确实引用 → 留主包正确。但 upscale-local 另被 aiUpscale.js:6、aiColorize.js:6（pkgAi 页）引用——§5.3 修正清单已含 upscale-local，结论不受影响 | ⚠️ 依据不完整（Minor-7） |
| 11 | §3 image-process「15 页引用」留主包 | 14 个页面 + `components/image-uploader/image-uploader.js:2`（spec 未提及的主包组件依赖方）；主包 8 页 + 分包 6 页 + 组件引用 → 留主包正确 | ⚠️ 计数口径（Minor-7/8） |
| 12 | §3 留主包 utils 清单（image-process/analytics/content-check/compare-helper/upscale-local/saliency-detect） | utils/ 目录共 **20 个文件**，spec 落位 19 个；**id-photo-geometry.js 未列入任何落位**（实际被主包 idPhoto.js:15 引用，应留主包——按"不动即留"语义无行为错误，但清单声称完备而不完备） | ⚠️ Minor-5 |
| 13 | §4 主包 require 分包（反向依赖）不存在 | 主包侧（app.js/主包 9 页/image-uploader）require 的 utils 全部在留主包清单内；无动态 require（`require([^'"]` 全仓 0 命中） | ✅ 属实 |
| 14 | §4/§5.3「仅需改页面 `../../utils/` → `../../../`」 | **不完整**：被迁移 utils 自身有 3 处内部 require 需同步修正（见 Important-2） | ❌ 缺失（Important-2） |
| 15 | §5.5 index.js「约 26 处」url 前缀更新 | 实测 `/pages/` 共 36 处，其中指向迁移页 **27 处**（另 9 处为主包页+index，不变） | ⚠️ 差 1，"约"字可容（不单列） |
| 16 | §2/T1 aiEnhance 未注册、无入口 | 不在 app.json 33 项内；全仓 grep（排除自身目录/.harness）0 引用；index.js/LAUNCH_DATES/index.wxss 均无 | ✅ 属实 |
| 17 | §2/T1 placeholder.png 无引用 | 全仓 grep（js/json/wxml/wxss）0 引用 | ✅ 属实 |
| 18 | §5.6 grep 模式覆盖所有硬编码跳转/分享路径 | 24 个迁移页**每页都有** `onShareAppMessage` 硬编码 `path:'/pages/x/x'`；另有 `gifDrafts.js:118` navigateTo、gifBatch/gifEditor/makeGif 的 wxml `<navigator url="/pages/...">` 5 处、index.wxml 数据绑定 url——全部落在 `/pages/(ai\|gif\|makeGif\|exif\|similarity\|formatRecommend\|colorAnalysis\|hiddenWatermark\|pdfToImage\|imgToPdf)` 模式覆盖内 | ✅ 覆盖面够，但见 Important-3（验证会假阳性） |
| 19 | （spec 未查）wxml/wxss 引用主包资源 | 迁移页 wxml 无 `src="../` / `src="/` 资源引用；wxss 无 `url()` / `@import`；全仓无 `<wxs>`；app.wxss 无 `@import`/`url()` | ✅ 无坑 |
| 20 | （spec 未查）usingComponents 跨包 | aiAvatar/aiOutpaint/aiStyle/aiTextToImage（均迁 pkgAi）+ compress/splice（留主包）使用 `image-uploader`，路径为**绝对路径** `/components/image-uploader/image-uploader`——组件留主包，绝对路径跨包引用合法，组件自身的 `../../utils/image-process` 因组件不动而无需改 | ✅ 无坑（但 spec 未列，Minor-8） |
| 21 | （spec 未查）其他 `/pages/` 引用 | 唯一 pages/ 之外的引用是 `utils/compare-helper.js:45` → `/pages/compare/compare`，compare 留主包，无需改 | ✅ 无坑 |
| 22 | （评审清单提示项）preloadRule ≤2MB | pkgAi 实测源码 404K（12 页）+ colorize-detect 3K ≈ 407K < 2MB 同页预下载上限 | ✅ 无坑 |
| 23 | （评审清单提示项）app.wxss 全局样式对分包页 | 全局 wxss 自动作用于分包页，无需迁移；实测 app.wxss 无 @import，无跨文件依赖 | ✅ 无坑 |
| 24 | （评审清单提示项）wx.cloud.init 时机 | `app.js:23` onLaunch 内 init，先于任何分包页 onLoad，分包页调云函数不受影响 | ✅ 无坑 |

体积实测（供 T6 阈值核对）：主包 9 页 377K + 留主包 utils（image-process 48.7K + piexif 不迁 + 其余约 20K）≈ 470K 口径成立；pkgAi 404K、pkgGif 229K、pkgTools 247K + 各自 utils，均远低于 500K 阈值。

## 发现

### Critical

**C-1：color-quantize.js 落位造成「分包 require 另一分包」的非法依赖，gifEditor 自适应编码路径将运行时崩溃。**
- 证据链：spec §3 将 color-quantize 归 pkgTools（理由"colorAnalysis 用"）；但 `utils/gif-encoder.js:17-23`：
  ```js
  function getMedianCut() {
    if (!_medianCut) {
      _medianCut = require('./color-quantize.js').medianCut;  // :20 懒加载
    }
  ```
  gif-encoder 归 pkgGif → `pkgGif/utils/gif-encoder.js` 的 `./color-quantize.js` 在 pkgGif/utils/ 不存在（被挪去 pkgTools）→ 微信分包规则禁止分包 A require 分包 B 的 JS → 模块缺失。这不是死代码：gifEditor.js:7 解构的 `buildGIFDiffAdaptive` 即自适应路径，真机点一次自适应导出就触发。
- 附带：`utils/format-recommend.js:20` 也 require color-quantize（同 pkgTools，本身没问题）——即 color-quantize 有**两个不同分包**的依赖方，不可能两全。
- 修复建议（最小改动）：**color-quantize.js 留主包**（7.8K，对冷启动目标无感）；随之 `gif-encoder.js:20` 与 `format-recommend.js:20` 的 require 改为 `../../utils/color-quantize`（分包→主包合法）。不建议双份复制（违背单一来源，CLAUDE.md 已吐槽云函数复制之痛）。

### Important

**I-2：被迁移 utils 自身的内部 require 修正完全缺失（spec §4 第 3 条与 T2-T4 均只处理"页面"的路径）。**
- 证据（utils→utils require 全清单实测）：
  - `utils/colorize-detect.js:10` → `./image-process`（迁 pkgAi 后须改 `../../utils/image-process`）
  - `utils/image-hash.js:17` → `./image-process`（迁 pkgTools 后同上）
  - `utils/gif-encoder.js:20` → `./color-quantize.js`（见 C-1）
  - 同包无影响的：`gif-compress.js:19-20` → gif-encoder/gif-frame-ops（均 pkgGif ✓）；`format-recommend.js:20` → color-quantize（按 C-1 方案须改）；留主包的 upscale-local/saliency-detect/image-process/content-check 互引不动 ✓。
- 连带验证盲区：T2-T4 的验证命令 `grep -rn "require('../../utils/" pkgX/` 只匹配 `../../utils/` 前缀，抓不到 utils 内部的 `./xxx` 形式——即便漏改，宣称的验证手段也不会发现（开发者工具编译会兜底报错，但任务书的"独立可验证"名存实亡）。应补验证：`grep -rn "require('\./" pkg*/utils/` 逐条核对落位。

**I-3：T5 残留验证 grep 必然假阳性，按任务书写的口径无法收敛。**
- 证据：重构完成后的新路径本身包含旧模式子串——`/pkgAi/pages/aiDescribe` 含 `/pages/ai`、`/pkgGif/pages/gifEditor` 含 `/pages/gif`。T5 验证 grep（全仓查 `/pages/(ai|gif|...)`）会对 app.json subpackages 三段、index.js 27 处新 url、wxml navigator 新 url 全部误报。"app.json 注释除外"的豁免表述也不成立（JSON 无注释；且误报源不止 app.json）。
- 修复建议：验证模式加左边界引号——`grep -rnE "['\"]\/pages\/(ai[A-Z]|gif|makeGif|exif|similarity|formatRecommend|colorAnalysis|hiddenWatermark|pdfToImage|imgToPdf)" `，只命中旧式字符串字面量。

### Minor

**M-4**：§7.2「32 个注册页面（33 - aiEnhance 删除）」算术错——aiEnhance 本就不在 33 个注册页内，重构后注册页仍是 33（9+12+5+7）。验收口径按 32 会数不上。
**M-5**：utils 落位清单缺 `id-photo-geometry.js`（idPhoto 引用，应留主包）。"不动即留"语义下无行为错误，但 §3 声称完备的落位清单应补齐为 20/20。
**M-6**：§3「（gif utils）仅被这 5 页引用」不准——实际 4 页（gifDrafts 仅 require analytics）。落位结论不变。
**M-7**：落位依据括号注释多处不完整：upscale-local「crop 引用」漏 aiUpscale/aiColorize；image-process「15 页引用」实为 14 页+1 组件。结论均正确，依据表述有误导后来人之嫌。
**M-8**：spec 通篇未提 `components/image-uploader`（4 个 pkgAi 页依赖的主包组件）。绝对路径引用使其无需改动（已验证无坑），但"依赖图已验证"的声明漏列主包组件这个依赖方，应补一句说明。

## 评审清单逐条结论

1. **覆盖度**：页面 33/33 全落位 ✅；utils 19/20 有落位（id-photo-geometry 缺列，M-5）。
2. **三层落位**：pkgX/pages + pkgX/utils 结构合法；页面→本包 utils `../../utils/x` 不变的路径推演成立 ✅；主包 require 分包确不存在 ✅；**但 spec 自己引入了分包→分包 require（C-1）**。
3. **硬约束**：四项"不涉及"声明全部成立——content-check 留主包且所有 guardImage/guardText 调用点仅随页面改一层路径；密钥/限流/云函数零改动；app.wxss 全局样式自动作用于分包页且无 @import 依赖（核查 #19/#23-24）✅。
4. **任务粒度**：T1-T4 顺序无关、T5 收口的结构合理；T4 对 exif.js 带 `.js` 后缀"指向本包不变"的提示正确 ✅。但 T2-T4 验证 grep 有 `./` 形式盲区（I-2）、T5 验证假阳性（I-3）；T2 括号列举"image-process/analytics/content-check 等"与 §5.3 五件套表述不完全一致（pkgGif 页实际只引前两类，"等"字侥幸不错，建议对齐列举）。
5. **风险遗漏**：风险表 5 条外漏了 C-1（跨分包 require）、I-2（utils 内部 require）、I-3（验证方法失效）。提示的三项（app.wxss 全局样式 / wx.cloud.init 时机 / preloadRule 2MB 上限）实测均无坑。
6. **占位符/歧义**：无 TBD/TODO ✅；歧义三处：M-4（32 vs 33）、"app.json 注释除外"（JSON 无注释）、M-6（5 页 vs 4 页）。

## 建议

1. （必须，对应 C-1）spec §3 修订：color-quantize.js 从 pkgTools 迁移清单移回「留主包 utils」；§5.3 require 修正清单补 `pkgGif/utils/gif-encoder.js`、`pkgTools/utils/format-recommend.js` 两处 color-quantize 引用改 `../../utils/`。
2. （必须，对应 I-2）spec §4 第 3 条与 T2-T4 各补一条：被迁移 utils 内部 require 主包 utils 的路径修正（colorize-detect/image-hash 的 `./image-process` → `../../utils/image-process`）；验证补 `grep -rn "require('\./" pkgX/utils/`。
3. （必须，对应 I-3）T5 验证命令改为带左边界引号的 grep 模式（见 I-3），删除"app.json 注释除外"表述。
4. （建议）§3 补 id-photo-geometry.js 留主包 + components/image-uploader 说明；§7.2 改"33 个注册页面"；修正"5 页引用/15 页引用"两处计数。
5. 修完后可直接进阶段 3（coding），无需二轮全量评审——本次评审已把依赖图全部实测核清，剩余仅上述文字修订。
