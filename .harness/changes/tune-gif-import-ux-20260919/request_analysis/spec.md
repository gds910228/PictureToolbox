# GIF 导入体验修复：双入口 + 导入指引 + 报错分来源

- 类型：tune
- 创建：2026-09-19（北京）
- 执行层：on-device（纯前端，零新依赖、零云函数）
- HITL②：方案已经用户会话内批准（2026-09-19，"同意"）

## 1. 背景与根因

线上反馈：GIF 编辑器 / GIF 批量处理两个页面点"上传"后弹出的是聊天记录选择器，用户无论怎么把 GIF 发进聊天都"无记录"。

**根因不是权限**（`wx.chooseMessageFile` 无 scope、不弹授权框），而是消息类型不匹配：

- 两页均用 `wx.chooseMessageFile({type:'file', extension:['gif']})`，只列出**文件消息**（蓝色文件卡片）。
- 用户以图片/表情形式发送的 GIF 是 image/emoji 消息，不在列表内；`extension:['gif']` 再过滤一层，列表恒为空。
- 手机端**没有官方 API 能从相册拿原始动图字节**：`wx.chooseMedia`/`wx.chooseImage` 相册选 GIF 会被微信转码为静态 JPG（取第一帧），"原图"不可依赖。
- 现有提示文案（"请从微信聊天记录中选择原始 GIF 文件"）没有告诉用户关键动作是"以文件形式发送"，引导失效。

## 2. 方案（已批准）

三件套，两页（gifEditor / gifBatch）同构：

1. **主入口不变**：`chooseGif()`（chooseMessageFile，type:'file'）保持为聊天导入主入口，不改 API 参数——type:'file' 是唯一保证拿到原始 .gif 字节的路径。
2. **加"从相册试试"辅助入口**：`chooseFromAlbum()` 调 `wx.chooseMedia({mediaType:['image'], sourceType:['album'], sizeType:['original']})`，结果走原有加载/解码路径。GIF8 头部校验是硬门槛兜底：
   - 若环境直出 .gif 原文件（机型/版本差异）→ 直接可用，赚到；
   - 若被转码为 JPG → 走现有校验失败分支，弹友好报错并引导回"从聊天导入"。**零下行风险**。
3. **加"导入指引"**：`showImportGuide()` 弹 `wx.showModal` 步骤引导（发到文件传输助手 → 聊天 + → 文件 → 选 .gif → 回小程序选该聊天；注明"以图片/表情发送的不是文件，选不到"；iOS 需先把相册 GIF 存到"文件"App）。
4. **报错文案分来源**：gifEditor 记 `_lastSource`（album/chat），"不是 GIF 文件" modal 按来源区分文案（相册来源 → 点明微信转码事实 + 引导）；gifBatch `_addFile` 记 `fromAlbum`，解码失败错误文案区分。

### UI 结构

- gifEditor：空态大卡片（点按=从聊天导入）保留；下方新增 `source-actions` 行：`从相册试试` + `导入指引` 两个 `btn-secondary`；hint 文案重写。
- gifBatch：`add-btn` 文案改"从聊天导入 GIF"，下方同样新增 `source-actions` 行 + hint。
- 样式：`.source-actions`（flex 双等分）+ `.source-btn`（btn-secondary 基础上加高/字号），全部用设计 token，遵守全局 button 单行规则（标签均 ≤5 字）。

## 3. 范围与非目标

**改**：`pkgGif/pages/gifEditor/{.js,.wxml,.wxss}`、`pkgGif/pages/gifBatch/{.js,.wxml,.wxss}`，共 6 文件。无新页面、不改 app.json/index.js/LAUNCH_DATES/icon（无新工具）。

**非目标**：
- 不放宽 `type:'file'` 为 `type:'all'`（图片消息经 chooseMessageFile 大概率已转 JPG，放宽后是"能看到但选了报错"，多一步挫败感，未真机验证前不做）。
- 不做"静态图取首帧"降级（GIF 编辑器里无意义）。
- PC 端不单独适配（chooseMessageFile 在 PC 弹会话选择器，发文件给文件传输助手成本极低，现有路径可用）。

## 4. 硬约束对照

| 约束 | 对照 |
|---|---|
| 执行层 | 纯 on-device，无云函数/限流/密钥/内容安全改动 |
| 页面注册 | 不涉及（无新页面/工具） |
| 设计 token | `.source-btn` 用 var(--space-*)，继承 app.wxss `.btn-secondary`，无 ad-hoc hex |
| button 单行 | "从相册试试""导入指引"均 5 字内，单行安全 |
| bindtap 事件对象 | 新增 handler 均单用途，无业务值透传问题 |
| 降级诚实 | 相册转 JPG 时明确告知"微信转码"事实，不静默；不伪造相册可用性 |

## 5. 成功标准

1. 两页均有"从聊天导入（主）/ 从相册试试（辅）/ 导入指引"三件套。
2. 相册选被转码的 JPG → gifEditor 弹分来源报错并引导；gifBatch 卡片显示分来源失败原因；坏文件**不可能**进入解码流程。
3. 按导入指引（+ → 文件 → .gif 蓝卡）操作后，chooseMessageFile 能看到该文件并正常加载/解码。
4. DevTools 无编译错误；真机预览无 Console error。

## 6. 验证要点（详见 unit_test/test_report.md）

- 真机（必须，DevTools 测不准 chooseMedia 转码行为）：相册选 GIF → 观察是否转码（预期多数环境转 JPG → 报错引导；若直出 .gif → 直接可用）。
- 聊天文件路径全流程：+ → 文件 发 .gif → 导入 → 解码 → 编辑/批量处理正常。
- 导入指引弹窗在 iOS/Android 渲染（\n 换行）正常。
