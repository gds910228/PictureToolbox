# GIF 引擎优化与健壮性

- 类型：feat（引擎优化）
- 创建：2026-09-06（北京）
- 状态：✅ 代码完成，待人工真机验证
- 前置：feat-gifeditor-20260906

## 阶段进度

| 阶段 | 状态 | 评审轮次 | 产出物 |
|------|------|----------|--------|
| 1 需求分析 | ✅ | - | request_analysis/spec.md |
| 2 需求评审 | ✅ 自审 | 1 | request_analysis/review/spec_review_v1.md |
| 3 编码实现 | ✅ | - | coding/coding_report_v1.md |
| 4 编码评审 | ✅ 自审 | 1 | coding/review/code_review_v1.md |
| 5 验证用例设计 | ✅ | - | unit_test/test_report.md |
| 6 验证用例评审 | ✅ 自审 | 1 | unit_test/review/ |
| 7 构建部署 | ✅ 适配 | - | deployment/deploy_report.md（无云函数/无新依赖） |
| 8 预览验证 | ✅ 代码级 | - | ci_result/ci_result.md（1500 fuzz + 87 单测 + 基准） |
| 9 部署验证 | ⏳ 待人工 | - | 需真机确认 |
| 10 用户确认 | ⏳ HITL⑤ | - | 待用户验收 |

## 验证用例数

- 解码器单元测试：**87 条全通过**
- Fuzz 测试：**1500 迭代全通过**（500/类 × 3 类，多种子验证）
- 性能基准：decode 504ms / encode 1.44s（640×640×60），均达标
- 差量编码：局部变化缩减 70.7%（≥40%），全帧劣化 0%（≤10%）
- Round-trip 像素：0 个像素差 >8（max diff = 0）

## 关键决议

### HITL① 需求待决议
- **差量编码策略**：两遍算法。第一遍检测擦除（alpha 255→0），第二遍编码。擦除时在前一帧设 disposal=2（非当前帧），当前帧从空画布全帧绘制。理由：disposal=2 是"显示后清空"，必须设在需要清空的帧上，而非有擦除的帧上。
- **透明索引选择**：PALETTE[255]（黑填充位），nearestIndex 永不返回 >215，安全保留。
- **dither 默认关闭**：Floyd-Steinberg 误差扩散会跨越 dirty-rect 边界产生伪影；无抖动时不变像素量化结果与前帧完全一致。
- **解码器安全限制**：新增 MAX_BLOCKS=65536 和 LZW maxIterations，防止损坏数据死循环。不影响正常解码。

### HITL② 计划评审后
- spec 自审通过，接口契约不变，批准编码。

### HITL③ 编码评审后
- 发现并修复 5 个 bug（含 1 个关键 disposal 时序 bug），fuzz 1500 迭代零失败。代码自审通过。

### HITL④ 部署参数
- 无云函数、无 env vars、无 npm 构建。gifEditor 导出改用 buildGIFDiff（1 行变更）。makeGif 不受影响。

### HITL⑤ 最终交付
- 待用户验收。代码级验证全部通过。

## 产出物索引

| 文件 | 说明 |
|------|------|
| `utils/gif-encoder.js` | 新增 buildGIFDiff（dirty-rect 差量编码） |
| `utils/gif-decoder.js` | 新增安全限制（块计数/LZW 迭代上限） |
| `scripts/gif-fuzz.js` | 种子化 fuzz 测试（三类属性断言） |
| `scripts/gif-bench.js` | 性能基准 + 差量编码数据表 |
| `pages/gifEditor/gifEditor.js` | 导出改用 buildGIFDiff |
| `coding/coding_report_v1.md` | 编码报告（含 5 个 bug 报告、数据表） |
| `unit_test/test_report.md` | 验证用例与结果 |
| `ci_result/ci_result.md` | 代码级验证结果 |

## 教训沉淀

1. **GIF disposal=2 的时序**：disposal 方法描述的是"帧显示后"的行为，不是"帧显示前"。当帧 N 有擦除（像素变透明）时，需要清空的是帧 N-1 之后的画布，因此 disposal=2 应设在帧 N-1 上。设在帧 N 上只会影响帧 N+1，帧 N 的透明像素仍会透传到帧 N-1。此 bug 通过 fuzz round-trip 测试发现。

2. **disposal=2 + dirty-rect 不兼容**：disposal=2 只清空当前帧矩形区域。如果帧是 dirty-rect（子矩形），则只清空子矩形，而非整画布。因此需要 disposal=2 的帧必须全帧编码。

3. **LZW 字母表范围必须与调色板大小匹配**：minCodeSize 决定 LZW 字面量范围（0 到 2^minCodeSize-1）。如果调色板有 N 种颜色但 transIndex ≥ N，LZW 编码器会生成超出字母表的字面量，解码器无法解析。fuzz 生成器中 transIndex 必须基于实际调色板大小（GCT 或 LCT），而非固定用 GCT 大小。

4. **fuzz 测试颜色必须在编码器色板内**：round-trip 测试中，随机 GIF 的颜色应取自编码器 PALETTE，否则重编码时的量化误差（最大 25.5/通道）会导致 ≤8 容差断言失败。
