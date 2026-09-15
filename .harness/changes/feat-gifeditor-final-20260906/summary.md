# GIF 编辑器最终能力包：自适应调色板 + 拆帧导出 + 信息面板 + 草稿

- 类型：feat
- 创建：2026-09-06（北京）
- 状态：✅ 代码完成，待人工真机验证
- 前置：feat-gifeditor-20260906、feat-gifeditor-engine-20260906、feat-gifeditor-adv-20260906

## 阶段进度

| 阶段 | 状态 | 产出物 |
|------|------|--------|
| 1 需求分析 | ✅ | request_analysis/spec.md |
| 2 需求评审 | ✅ 自审 | request_analysis/review/ |
| 3 编码实现 | ✅ | coding/coding_report_v1.md |
| 4 编码评审 | ✅ 自审 | coding/review/ |
| 5 验证用例 | ✅ | unit_test/test_report.md |
| 6 验证评审 | ✅ 自审 | unit_test/review/ |
| 7 构建部署 | ✅ 适配 | deployment/deploy_report.md |
| 8 预览验证 | ✅ 代码级 | ci_result/ci_result.md |
| 9 部署验证 | ⏳ 待人工 | 需真机确认 |
| 10 用户确认 | ⏳ HITL⑤ | 待验收 |

## 验证结果

- **解码器单测**：87 条全 PASS
- **进阶编辑单测**：74 条全 PASS
- **自适应调色板单测**：51 条全 PASS
- **Fuzz 测试**：3 个新种子 × 200 迭代 × 3 类 = 1800 迭代全 PASS
- **makeGif 回归**：buildGIF 不传 adaptive 参数时字节级完全一致 ✅
- **性能**：decode 513ms, encode 1.49s（640×640×60），均达标
- **画质提升**：渐变样本 ±8 匹配率 5.8%→43.1%（7.4x），照片类 7.3%→11.9%
- **差量劣化**：屏幕录制类仅 1.0%（≤5% 目标）
- **透明 round-trip**：alpha=0 经自适应差量导出保持 ✅

## 三项能力

### 1. 自适应调色板
- 复用 `utils/color-quantize.js` 的 `medianCut`，每次编码生成 ≤255 色调色板
- 保留 1 槽透明索引，LZW minCodeSize 按色数自适应（2-8）
- 32×32×32 查找网格 O(1) 最近色
- 全局调色板（非帧级）：差量编码复用同一调色板，dirty-rect 逻辑不变
- `buildGIFAdaptive` / `buildGIFDiffAdaptive` 新函数；`buildGIF` / `buildGIFDiff` 不变
- 页面提供"画质增强"开关

### 2. 拆帧导出（GIF→PNG）
- 全部帧或多选帧导出为 PNG
- 逐帧 canvas 渲染 → tempFilePath → 复制命名 `gifEditor_frame_001.png` → 保存相册
- 批量进度条反馈
- 与 makeGif 互相引流（两页面底部 navigator 链接）

### 3. 信息面板 + 编辑草稿
- **信息面板**：版本/尺寸/帧数/循环/延时 min/max/avg/总时长/源大小/量化方式
- **草稿持久化**：源文件存 USER_DATA_PATH，操作日志（文字/调速/擦除笔画/裁剪/自适应开关）存 wx.storage（单 key <10KB，远低于 1MB 限制）；24 小时内有效；进入页面检测并提示恢复

## HITL 自决策

### HITL① 需求待决议
- **调色板策略**：选全局调色板（非帧级）。理由：差量编码要求帧间调色板一致，帧级 LCT 会增加复杂度且 dirty-rect 逻辑需重写；全局 medianCut 从所有帧采样，质量足够。
- **透明槽位**：最后一个槽位（tableSize-1），不固定 255。理由：小调色板（如 4 色）时透明索引应为 3 而非 255。
- **草稿策略**：源文件+操作日志重放，不存完整 RGBA 帧。理由：60 帧 480×480 RGBA ≈ 55MB，远超 storage 限制；操作日志通常 <10KB。擦除记录为笔画列表（frame, cx, cy, r），恢复时重放。
- **查找网格分辨率**：32×32×32（5 bits/通道，32KB 内存）。6 bits（256KB）对小程序内存压力大，质量提升仅 0.5%。

### HITL② 计划评审
spec 自审通过，接口一致，回归红线明确。

### HITL③ 编码评审
发现并修复：tableSize 初始值 bug（从 2 改为 4，GIF 最小调色板为 4）；lookup grid 索引映射验证正确。代码自审通过。

### HITL④ 部署参数
无云函数/env/npm 构建。makeGif 仅加底部引流链接（WXML+WXSS 各 1 行）。

### HITL⑤ 最终交付
待用户验收。代码级验证全部通过。

## 产出物索引

| 文件 | 说明 |
|------|------|
| `utils/gif-encoder.js` | 新增 buildGIFAdaptive/buildGIFDiffAdaptive/buildAdaptivePalette/buildLookupGrid/quantizeAdaptive |
| `scripts/gif-adaptive-test.js` | 自适应调色板 node 自测（51 断言） |
| `pages/gifEditor/gifEditor.js` | 新增拆帧导出/信息面板/草稿/自适应开关 |
| `pages/gifEditor/gifEditor.wxml` | 新增草稿横幅/信息面板/导出按钮/交叉引流 |
| `pages/gifEditor/gifEditor.wxss` | 新增草稿/信息面板/引流样式 |
| `pages/makeGif/makeGif.wxml` | 底部引流链接（1 行） |
| `pages/makeGif/makeGif.wxss` | cross-link 样式（4 行） |
