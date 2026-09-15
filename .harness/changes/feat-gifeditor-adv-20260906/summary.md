# GIF 编辑器进阶编辑能力包

- 类型：feat
- 创建：2026-09-06（北京）
- 状态：✅ 代码完成，待人工真机验证
- 前置：feat-gifeditor-20260906、feat-gifeditor-engine-20260906

## 阶段进度

| 阶段 | 状态 | 评审轮次 | 产出物 |
|------|------|----------|--------|
| 1 需求分析 | ✅ | - | request_analysis/spec.md |
| 2 需求评审 | ✅ 自审 | 1 | request_analysis/review/spec_review_v1.md |
| 3 编码实现 | ✅ | - | coding/coding_report_v1.md |
| 4 编码评审 | ✅ 自审 | 1 | coding/review/code_review_v1.md |
| 5 验证用例设计 | ✅ | - | unit_test/test_report.md |
| 6 验证用例评审 | ✅ 自审 | 1 | unit_test/review/ |
| 7 构建部署 | ✅ 适配 | - | deployment/deploy_report.md |
| 8 预览验证 | ✅ 代码级 | - | ci_result/ci_result.md |
| 9 部署验证 | ⏳ 待人工 | - | 需真机确认 |
| 10 用户确认 | ⏳ HITL⑤ | - | 待验收 |

## 验证结果

- **解码器单测**：87 条全 PASS
- **进阶编辑单测**：74 条全 PASS（裁剪/擦除/透明保持/九宫格/文字测量）
- **Fuzz 测试**：3 个新种子 × 200 迭代 × 3 类 = 1800 迭代全 PASS
- **透明 round-trip**：擦除 alpha=0 经 buildGIFDiff 导出→解码保持 alpha=0 ✅
- **裁剪 round-trip**：帧数/延时不变，尺寸=裁剪尺寸 ✅
- **性能基准**：decode 511ms, encode 1.49s（640×640×60），均达标
- **差量编码**：局部变化缩减 70.7%，全帧劣化 0%
- **语法检查**：所有 JS 文件 node -c 通过
- **WXML/JS 方法对应**：所有事件处理器均有对应方法

## 关键决议（HITL 自决策）

### HITL① 需求待决议
- **文字渲染策略**：文字不修改 base frame rgba，在 canvas 上叠加绘制；导出时逐帧烘焙到像素。理由：支持文字的增删改而不破坏原始帧数据，撤销简单。差量编码自动检测文字区域的像素变化，dirty-rect 自然覆盖文字包围盒。
- **擦除撤销粒度**：每笔 stroke 一个整帧快照（≤10 步）。理由：实现简单可靠，480×480×4×10 ≈ 9MB/帧可接受；bbox 级撤销更省内存但复杂度高，YAGNI。
- **裁剪撤销**：仅保存一次裁剪前快照（单次撤销），不支持多级裁剪撤销。理由：裁剪是破坏性操作，用户通常确认后不回退；多级快照内存开销大。
- **懒加载策略**：缩略图按批生成（每批 8 帧），滚动到接近末尾时触发下一批；首屏只生成前 8 帧。阈值：LAZY_THUMB_BATCH=8。

### HITL② 计划评审
spec 自审通过，接口一致，范围明确。

### HITL③ 编码评审
发现并修复坐标映射问题（overlay 与 canvas 缩放不一致），引入 canvasScale 统一 CSS px ↔ canvas px 映射。代码自审通过。

### HITL④ 部署参数
无云函数、无 env vars、无 npm 构建。gifEditor.js 增量修改，新增 gif-frame-ops.js。

### HITL⑤ 最终交付
待用户验收。代码级验证全部通过。

## 产出物索引

| 文件 | 说明 |
|------|------|
| `utils/gif-frame-ops.js` | 纯像素操作（裁剪/擦除/快照/九宫格/文字测量） |
| `scripts/gif-adv-test.js` | 进阶编辑 node 自测（74 断言） |
| `pages/gifEditor/gifEditor.js` | 页面逻辑（裁剪/文字/擦除/懒加载/进度） |
| `pages/gifEditor/gifEditor.wxml` | 页面结构（4 模式切换） |
| `pages/gifEditor/gifEditor.wxss` | 页面样式 |

## 教训沉淀

1. **Canvas overlay 坐标映射**：当 canvas 以缩放比例显示时（CSS 尺寸 ≠ 内部分辨率），所有覆盖层（裁剪框、可拖拽文字）和触摸坐标必须使用统一的 scale 因子。在 WXML 中用 `style="left:{{x * canvasScale}}px"` 缩放 overlay 位置，在 JS 中用 `1/canvasScale` 将触摸 CSS 坐标转回 canvas 像素。遗漏此映射会导致小屏设备上裁剪框/文字偏移。
