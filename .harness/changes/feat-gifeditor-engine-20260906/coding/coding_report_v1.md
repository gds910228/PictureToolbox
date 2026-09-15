# 编码报告：GIF 引擎优化与健壮性（v1）

- 日期：2026-09-06
- 状态：✅ 完成

## 变更文件清单

| 文件 | 类型 | 说明 |
|------|------|------|
| `utils/gif-encoder.js` | 修改 | 新增 `buildGIFDiff`（dirty-rect 差量编码）；保留 `buildGIF` 不变 |
| `utils/gif-decoder.js` | 修改 | 新增安全限制（块计数上限、LZW 迭代上限），防止损坏数据死循环 |
| `scripts/gif-fuzz.js` | 新增 | 种子化 fuzz 测试（三类属性断言，≥500 迭代/类） |
| `scripts/gif-bench.js` | 新增 | 性能基准 + 差量编码数据表 |
| `pages/gifEditor/gifEditor.js` | 修改 | 导出改用 `buildGIFDiff`（dither:false） |

## 一、差量编码实现（buildGIFDiff）

### 算法
1. **第一遍**：检测每对相邻帧是否有"擦除"（alpha 255→0）
2. **第二遍**：逐帧编码
   - 画布已清空（首帧或前帧 disposal=2）→ 全帧量化
   - 画布保留且无擦除 → dirty-rect 差量，不变像素用透明索引 255
   - 无变化 → 1×1 透明像素保留延时
   - 当前帧需要 disposal=2（下一帧有擦除）→ 必须全帧（disposal=2 只清当前帧矩形）
3. 透明索引 255：PALETTE 的黑填充位，nearestIndex 永不返回 >215，安全保留

### 量化结果（640×640×60 帧）

| 样本类型 | 全帧编码 | 差量编码 | 缩减率 | 目标 | 状态 |
|----------|----------|----------|--------|------|------|
| 局部变化（屏幕录制式） | 80.3 KB | 23.6 KB | **70.7%** | ≥40% | ✅ PASS |
| 全帧变化 | 3.64 MB | 3.64 MB | **0.0%** | ≤10% 劣化 | ✅ PASS |
| 渐变（中等变化） | 524.6 KB | 524.6 KB | 0.0% | N/A | INFO |
| 局部变化（240×240×60） | 29.5 KB | 9.9 KB | **66.5%** | ≥40% | ✅ PASS |
| 全帧变化（240×240×30） | 287.1 KB | 287.1 KB | 0.0% | ≤10% 劣化 | ✅ PASS |

### Round-trip 像素验证
- 480×480×20 帧局部变化样本
- 最大每通道差：**0**
- 差 >8 的像素：**0 / 13,824,000（0.000%）**
- 帧数一致：✅
- 无结构性错误：✅

## 二、Fuzz 测试基建

### 生成器特性
- 种子化 PRNG（mulberry32），种子打印在输出中
- 随机尺寸（4-48px）、帧数（1-10）、GCT/LCT（2-256 色，幂次）
- 随机透明索引、disposal 0-3、隔行扫描、延迟
- 注释扩展（0xFE）、未知扩展（0x0F）
- 颜色取自编码器 PALETTE（保证 round-trip 无损）
- 模拟画布状态跟踪（disposal 2 清除）

### 三类属性断言
- **(a) 合法样本**（500 迭代）：decode 不抛错、帧数一致、rgba 尺寸正确、<1s
- **(b) Round-trip**（500 迭代）：decode→buildGIFDiff→decode 帧数一致、≥99% 像素每通道差 ≤8
- **(c) 畸变样本**（500 迭代）：截断/位翻转/块长度破坏，decode 或 throw，不死循环/不崩溃，<1s

### 最终结果
```
(a) Valid samples:     500 pass / 0 fail (230ms, 0.5ms/iter)
(b) Round-trip:        500 pass / 0 fail (496ms, 1.0ms/iter)
(c) Corrupted samples: 500 pass / 0 fail (58ms, 0.1ms/iter)
```
多种子验证：seed=42、seed=99999 均 200/200 全过。

## 三、发现并修复的 Bug

### Bug 1：fuzz 生成器 transIndex 超出 LCT 范围
- **现象**：LZW 解码报"无效码 15（nextCode=11）"
- **根因**：`transIndex` 基于 GCT 大小（128 色）计算，但帧使用 LCT（8 色，minCodeSize=3）。透明索引可达 79，超出 LZW 字母表范围（0-7），编码器生成非法字面量
- **修复**：先决定调色板（GCT/LCT），再基于实际调色板大小计算 transIndex；画布用 Int16Array（-1=未绘制）替代 Uint8Array（255=未绘制）
- **复现种子**：20260906（iter=0）

### Bug 2：256 色调色板含随机非 PALETTE 颜色
- **现象**：round-trip 像素差 maxDiff=25
- **根因**：`randomPalette` 对索引 216-255 生成随机 RGB 颜色，不在编码器 216 色 PALETTE 中，重编码时量化误差达 25
- **修复**：所有颜色从 `PALETTE[i % 216]` 循环取，保证 round-trip 无损
- **复现种子**：20360906（iter=3）

### Bug 3：差量编码 disposal=2 设在错误的帧上（关键）
- **现象**：round-trip alpha 不匹配（透明像素变不透明）
- **根因**：当帧 N 有擦除（alpha 255→0）时，编码器在帧 N 上设 disposal=2。但 disposal=2 是"显示后清空"，应设在帧 N-1 上（清空后帧 N 从空画布开始）。帧 N 上的 disposal=2 只影响帧 N+1，帧 N 的透明像素仍透传到帧 N-1 的内容
- **修复**：改为两遍算法——第一遍检测擦除，第二遍在"下一帧有擦除"的帧上设 disposal=2
- **复现种子**：20384663（iter=3）

### Bug 4：disposal=2 帧使用 dirty-rect 导致部分清除
- **现象**：round-trip alpha 不匹配（28 个像素）
- **根因**：帧 N 需要 disposal=2（帧 N+1 有擦除），但帧 N 被编码为 dirty-rect（20×4 子矩形）。disposal=2 只清空该子矩形，而帧 N+1 期望整画布被清空
- **修复**：当 `useDisposal2=true` 时强制全帧编码（`canvasCleared || useDisposal2`）
- **复现种子**：21620027（iter=159）

### Bug 5：测试脚本变量名错误
- **现象**：`r is not defined` 异常
- **根因**：round-trip 测试中引用了不存在的变量 `r.elapsed`（应为 `r1`）
- **修复**：删除多余的耗时检查（已在 decodeWithTimeout 中覆盖）

## 四、解码器健壮性增强

- 主块循环增加 `MAX_BLOCKS=65536` 计数上限
- LZW 解码增加 `maxIterations = pixelCount*4 + 8192` 迭代上限
- 防止损坏数据导致死循环（fuzz 畸变样本验证：500/500 在 1s 内完成或抛错）

## 五、性能基准（640×640×60 帧）

运行环境：Node v22.22.3 / Linux x64

| 操作 | 耗时 | 目标 | 状态 |
|------|------|------|------|
| decodeGif（全帧变化） | **504ms** | ≤2s | ✅ PASS |
| decodeGif（差量局部） | **61ms** | ≤2s | ✅ PASS |
| buildGIF（全帧编码） | **1.28s** | ≤5s | ✅ PASS |
| buildGIFDiff（全帧变化） | **1.44s** | ≤5s | ✅ PASS |
| buildGIFDiff（局部变化） | **169ms** | ≤5s | ✅ PASS |

无需优化即达标。差量编码在局部变化场景下编码速度也显著提升（169ms vs 628ms）。
