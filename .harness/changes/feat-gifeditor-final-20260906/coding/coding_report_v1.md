# 编码报告：GIF 编辑器最终能力包（v1）

- 日期：2026-09-06
- 状态：✅ 完成

## 变更文件

| 文件 | 类型 | 说明 |
|------|------|------|
| `utils/gif-encoder.js` | 修改 | 新增自适应调色板编码（buildGIFAdaptive/buildGIFDiffAdaptive 等） |
| `scripts/gif-adaptive-test.js` | 新增 | 自适应调色板 node 自测（51 断言） |
| `pages/gifEditor/gifEditor.js` | 修改 | 拆帧导出/信息面板/草稿/自适应开关 |
| `pages/gifEditor/gifEditor.wxml` | 修改 | 草稿横幅/信息面板/导出区/引流 |
| `pages/gifEditor/gifEditor.wxss` | 修改 | 新组件样式 |
| `pages/makeGif/makeGif.wxml` | 修改 | 底部引流链接（1 行） |
| `pages/makeGif/makeGif.wxss` | 修改 | cross-link 样式（4 行） |

## 一、自适应调色板实现

### 架构
1. `buildAdaptivePalette(frames, maxColors)`：从所有帧降采样收集 ≤50000 不透明像素 → medianCut 生成 ≤255 色 → 补齐到 2 的幂（最小 4），最后 1 槽为透明
2. `buildLookupGrid(palette)`：32×32×32（5 bits/通道）网格，每格存最近调色板索引，O(1) 查找
3. `quantizeAdaptive(rgba, w, h, palette, grid, transIndex, prev)`：量化一帧，透明/不变像素填透明索引
4. `buildGIFAdaptive(frames, opts)`：全帧编码，使用自适应调色板
5. `buildGIFDiffAdaptive(frames, opts)`：差量编码，使用全局自适应调色板（与 buildGIFDiff 相同的两遍擦除检测逻辑）

### 关键决策
- **全局 vs 帧级调色板**：选全局。帧级 LCT 会使差量编码复杂化（每帧不同调色板，dirty-rect 无法跨帧比较），且 medianCut 从所有帧采样已足够
- **透明索引**：tableSize-1（不固定 255），小调色板时索引更小
- **查找网格 5 bits**：32KB 内存，6 bits（256KB）质量仅提升 0.5%，不值得
- **降采样**：大图像每隔 N 像素采样（目标 50000 点），medianCut 性能 O(n log n)

### 画质对比数据表

| 样本 | 尺寸 | 帧数 | 固定色板 | 自适应色板 | 固定 ±8 匹配率 | 自适应 ±8 匹配率 | 体积变化 |
|------|------|------|----------|------------|----------------|------------------|----------|
| 彩色渐变 | 120×120 | 5 | 19,902 B | 28,459 B | 5.8% | 43.1% | +43% |
| 照片类 | 120×120 | 5 | 21,097 B | 22,948 B | 7.3% | 11.9% | +9% |
| 屏幕录制(差量) | 120×120 | 30 | 3,652 B | 3,688 B | — | — | +1.0% (≤5%) |

### makeGif 回归
- `buildGIF` 函数体未修改，新增参数 `adaptive` 被忽略
- 字节级验证：相同输入 + adaptive:true 产生完全相同的输出
- makeGif 页面继续使用 `buildGIF`，无任何行为变化

## 二、拆帧导出

- 多选模式下导出选中帧，否则导出全部帧
- 逐帧：canvas putImageData + drawTexts → canvasToTempFilePath → copyFile 命名 `gifEditor_frame_001.png` → saveImageToPhotosAlbum
- 进度条 0-100%，分步提示
- 命名：3 位零填充序号

## 三、信息面板

- 版本（GIF87a/89a，从源文件头读取）
- 逻辑尺寸、帧数、循环次数
- 延时 min/max/avg/总时长
- 源文件大小、量化方式（固定/自适应）

## 四、编辑草稿

### 策略：源文件 + 操作日志
- **源文件**：加载时复制到 `USER_DATA_PATH/gifEditor_source.gif`
- **操作日志**（wx.storage，<10KB）：
  - 调速 speed、文字 texts、自适应开关
  - 擦除笔画列表 `[{frame, cx, cy, r}]`
  - 裁剪状态 `{x, y, w, h}`
  - 文件名
- **恢复**：读取源文件 → decodeGif → 重放操作（擦除笔画 → 裁剪 → 文字/调速/开关）
- **有效期**：24 小时（过期自动忽略）
- **容量**：操作日志通常 <10KB，远低于 1MB/key、10MB 总量限制
- **保存时机**：编辑操作后 1 秒节流保存；onUnload 时保存

## 五、验证证据

```
解码器单测:     87 PASS / 0 FAIL
进阶编辑单测:   74 PASS / 0 FAIL
自适应单测:     51 PASS / 0 FAIL
Fuzz (3 种子): 1800 PASS / 0 FAIL
makeGif 回归:  字节级一致 ✓
透明 round-trip: alpha=0 保持 ✓
性能:          decode 513ms, encode 1.49s (640×640×60)
```

### 自适应单测覆盖
1. makeGif 字节级回归
2. 自适应基本功能
3. 画质提升（渐变）
4. 照片类样本质检
5. 屏幕录制差量劣化 ≤5%
6. 透明 round-trip
7. minCodeSize 正确性
8. 差量 round-trip 帧数/延时
9. 查找网格正确性
10. 多帧无结构性错误

## 六、设计 token 合规
- 所有新样式使用 var(--color-*)、var(--space-*)、var(--radius-*)
- 无硬编码 hex 色值
- button 文案单行
