# 需求规格：GIF 引擎优化与健壮性

- 类型：feat（引擎优化）
- 创建：2026-09-06（北京）
- 执行层：on-device（纯本地，零新依赖）
- 前置：feat-gifeditor-20260906（GIF 解码器 + 编辑器页面）

## 1. 需求概述

对 GIF 引擎（解码器/编码器）做上线前最后一轮硬骨头优化：差量重编码减小导出体积、fuzz 基建保证健壮性、性能基准验证达标。decodeGif 公开契约不变。

## 2. 功能范围

### 2.1 差量重编码（buildGIFDiff）
- 对比相邻合成帧计算变化区域包围盒（dirty-rect）
- 仅编码变化矩形（image descriptor 携带 left/top 偏移）
- 不变像素用透明索引 255 跳过（disposal=1，画布保留）
- 擦除（alpha 255→0）时：前一帧用 disposal=2（清空画布），当前帧全帧绘制
- 无变化帧：1×1 透明像素保留延时
- 量化目标：
  - 局部变化样本：体积缩减 ≥40%
  - 全帧变化样本：劣化 ≤10%
  - round-trip：≥99% 像素每通道差 ≤8，无结构性错误

### 2.2 随机模糊测试（fuzz）
- 种子化随机 GIF 生成器（种子可复现、打印输出）
- 随机维度：尺寸/帧数/GCT/LCT/透明/disposal 0-3/隔行/延迟/注释扩展/未知扩展
- 三类属性断言，每类 ≥500 次迭代：
  - (a) 合法样本：decode 不抛错、帧数一致、尺寸正确
  - (b) round-trip：decode→buildGIFDiff→decode 帧数/延时一致、像素 ≥99% 每通道差 ≤8
  - (c) 畸变样本（截断/位翻转/块长度破坏）：decode 或 throw，不死循环/不崩溃，<1s/样本
- 发现 bug 全部修复，报告逐条列出

### 2.3 性能基准
- 640×640×60 帧 GIF 的 decode 与 encode 耗时
- decode >2s 或 encode >5s 需优化
- 注明运行环境

### 2.4 页面适配
- gifEditor 导出改用 buildGIFDiff
- makeGif 继续使用 buildGIF（不变）
- decodeGif 公开契约不变

## 3. 硬约束
- decodeGif 公开契约与返回结构不得改变
- 旧的全帧编码产物仍必须可正常解码
- 零 npm 新依赖
- 引擎不依赖 wx API
- 不破坏 makeGif 及其他存量功能

## 4. 验证标准
- `node scripts/gif-decoder.test.js` 全 PASS（87 断言）
- `node scripts/gif-fuzz.js 500` 三类全 PASS（1500 迭代）
- `node scripts/gif-bench.js` 性能达标
- 差量编码数据表交付
- bug 报告逐条列出
- JS 语法检查通过
