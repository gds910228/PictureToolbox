# feat-greetingAnim-20261024「今日问候·动图」

- 类型：feat
- 创建：2026-10-24（北京）
- 状态：编码完成，待真机验证（纯前端分包，无云端部署项）
- HITL①（用户对话决议）：选定方案②——GIF 动图·文字动效（呼吸+逐字），抖动先不开

## 阶段进度

| 阶段 | 状态 | 产出物 |
|---|---|---|
| 1 需求分析 | ✅ | request_analysis/spec.md |
| 2 需求评审 | ✅ | 自审（方案菜单四选一，用户拍板②） |
| 3 编码实现 | ✅ | 本文件 §改动清单 |
| 4 编码评审 | ✅ | node --check + 时间线数学实测 + 编码器烟雾测试 |
| 5 验证用例设计 | ✅ | unit_test/test_report.md（15 条） |
| 8 预览验证 | ⏳ | 待真机执行 |

## 改动清单

- 新增：`pkgGreeting/utils/gif-encoder.js`（自 pkgGif 复制，26.6KB；懒加载主包
  `utils/color-quantize.js` 的相对路径深度不变仍成立）
- `pkgGreeting/pages/greeting/greeting.js`：
  - 绘制收进 `_drawGreeting(ctx, t, imgs, animKind)`（设计坐标 1080×1440，t∈[0,1]）
  - `_render()` 静图分支（t=1 全显）；`_renderAnim()` 新增：帧 720×960（ctx.scale 2/3）、
    呼吸 12 帧 / 逐字 16 帧、100ms/帧无限循环、`buildGIF(..., {loop:0, dither:false})`
    → 写 `USER_DATA_PATH`
  - `_ensureCanvas(w, h)` 支持分辨率切换；发送/保存按 `outIsGif` 分支
    （GIF → `wx.shareFileMessage`（gifEditor 生产先例），兜底存相册）
  - 埋点：greeting_render 增 anim 字段、greeting_save 增 gif 字段（不新增事件名）
- `greeting.wxml`：步骤 2 增"要不要动一动"选项行；步骤 3 成品标题/提示按动图态切换
- `greeting.wxss`：动效选项复用 g-slot 样式，零新增

## 已执行验证证据

- `node --check` greeting.js / gif-encoder.js 通过
- 编码器烟雾测试：3 合成帧 → GIF89a 头 + NETSCAPE2.0 循环扩展 + 0x3B 尾字节 ✓
- 动效时间线实测：逐字 t=0→0字、0.6→全字、其后停留 ✓；呼吸 alpha 0.78~1.00（全程可读）✓

## 部署与回归

无云端变更。开发者工具重新编译/预览即可；真机按 test_report 15 条执行。
重点观测：GIF 发送到聊天后自动播放（用例 8）、文件大小与色带（用例 7，超 4MB 或色带严重
→ 打开 buildGIF 的 dither 开关重评）。

## 迭代记录（真机验证后）

- 2026-10-24 用户确认动图发送生效（用例 8 过）。拍板两项增强：
  1. **dither 开启**：`buildGIF(..., dither: true)`。合成渐变帧实测体积增幅 ~254%
     （LZW 对抖动噪点不友好），真实照片场景预计小得多——真机复测文件大小，若超 4MB
     再评估（降帧 12→10 或回调开关）。
  2. **照片缓推（Ken Burns）**：`_drawCover` 增 zoom 参数，动效态照片呼吸式推近
     1→1.05→1（cos 相位保证首尾同帧无缝循环），同时作用于"文字呼吸/逐字浮现"两种
     动效（不新增选项，长辈选择项保持 3 个）；静图态 zoom=1 不变。
- 复验：zoom 时间线实测首尾 1.000/峰值 1.050 ✓；`node --check` 通过。

## 教训沉淀

- 跨分包复用二进制工具（GIF 编码器）只能复制或上提主包；本次复制并实测懒加载相对路径不受分包影响。
- gifEditor 的 shareFileMessage 是项目内"GIF 发聊天"的既定先例，新场景直接沿用而非另探路径。
