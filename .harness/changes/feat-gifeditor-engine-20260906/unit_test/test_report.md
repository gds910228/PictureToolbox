# 验证用例与结果：GIF 引擎优化

- 日期：2026-09-06
- 验证方式：node 自动化测试（本环境无微信开发者工具/真机）

## 自动化测试结果

### 1. 解码器单元测试
```
命令：node scripts/gif-decoder.test.js
结果：PASS 87 / FAIL 0
```
覆盖：GCT/LCT、透明索引、隔行扫描、disposal 0/1/2、延迟换算、循环计数、非法输入 throw、单帧/多帧 round-trip、GIF87a、透明叠加、帧序号。

### 2. Fuzz 测试（500 迭代/类，共 1500）
```
命令：node scripts/gif-fuzz.js 500 20260906

(a) Valid samples:     500 pass / 0 fail (230ms, 0.5ms/iter)
(b) Round-trip:        500 pass / 0 fail (496ms, 1.0ms/iter)
(c) Corrupted samples: 500 pass / 0 fail (58ms, 0.1ms/iter)
```
- (a) 随机合法 GIF：decode 不抛错、帧数一致、rgba 尺寸正确
- (b) decode→buildGIFDiff→decode：帧数一致、≥99% 像素每通道差 ≤8
- (c) 截断/位翻转/块长度破坏：decode 或 throw，不死循环/不崩溃，<1s/样本
- 多种子验证：seed=42（200 迭代）、seed=99999（200 迭代）均全过

### 3. 性能基准
```
命令：node scripts/gif-bench.js

640×640×60 帧：
  decodeGif（全帧变化）：504ms （目标 ≤2s）✅
  decodeGif（差量局部）：61ms  （目标 ≤2s）✅
  buildGIF（全帧编码）：1.28s （目标 ≤5s）✅
  buildGIFDiff（全帧）：1.44s （目标 ≤5s）✅
  buildGIFDiff（局部）：169ms （目标 ≤5s）✅
```

### 4. 差量编码数据表

| 样本 | 尺寸 | 帧数 | 全帧编码 | 差量编码 | 缩减率 | 目标 | 状态 |
|------|------|------|----------|----------|--------|------|------|
| 局部变化（屏幕录制式） | 640×640 | 60 | 80.3 KB | 23.6 KB | 70.7% | ≥40% | ✅ |
| 全帧变化 | 640×640 | 60 | 3.64 MB | 3.64 MB | 0.0% | ≤10% 劣化 | ✅ |
| 渐变 | 640×640 | 60 | 524.6 KB | 524.6 KB | 0.0% | N/A | INFO |
| 局部变化（小） | 240×240 | 60 | 29.5 KB | 9.9 KB | 66.5% | ≥40% | ✅ |
| 全帧变化（小） | 240×240 | 30 | 287.1 KB | 287.1 KB | 0.0% | ≤10% 劣化 | ✅ |

### 5. Round-trip 像素验证
- 480×480×20 帧局部变化样本
- 最大每通道差：0
- 差 >8 像素：0 / 13,824,000（0.000%）
- 帧数一致、无结构性错误

### 6. 回归检查
- `utils/gif-encoder.js`：`buildGIF` 函数未修改，仅新增 `buildGIFDiff`
- `pages/makeGif/makeGif.js`：继续使用 `buildGIF`，未修改
- `utils/gif-decoder.js`：公开接口 `decodeGif(arrayBuffer)` 契约不变，仅新增内部安全限制
- `pages/gifEditor/gifEditor.js`：导出改用 `buildGIFDiff`（dither:false）
- 所有 JS 文件 `node -c` 语法检查通过

## 待人工真机验证

沿用 feat-gifeditor-20260906 的 V1-V14 手动验证用例，重点关注：
- 导出 GIF 体积是否显著减小（差量编码生效）
- 导出 GIF 在相册/微信聊天中播放正常（无花屏/丢帧/错位）
- 含透明背景的 GIF 编辑后透明度保留
