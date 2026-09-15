# 编码报告：GIF 编辑器（v1）

- 日期：2026-09-06
- 状态：✅ 完成

## 变更文件清单

| 文件 | 类型 | 说明 |
|------|------|------|
| `utils/gif-decoder.js` | 新增 | GIF89a/87a 解码器（~340 行，零依赖） |
| `scripts/gif-decoder.test.js` | 新增 | node 自测脚本（13 组测试，87 条断言） |
| `pages/gifEditor/gifEditor.js` | 新增 | 页面逻辑（选图/解码/编辑/预览/导出） |
| `pages/gifEditor/gifEditor.wxml` | 新增 | 页面结构 |
| `pages/gifEditor/gifEditor.wxss` | 新增 | 页面样式（设计 token） |
| `pages/gifEditor/gifEditor.json` | 新增 | 页面配置 |
| `app.json` | 修改 | pages[] 注册 |
| `pages/index/index.js` | 修改 | creative 组 tools[] + LAUNCH_DATES |
| `pages/index/index.wxss` | 修改 | .icon-gifEditor 图标 |

## 关键实现决策

### 1. LZW 码宽递增条件（关键坑）

解码器码宽递增必须使用 **post-increment `>=`**（`nextCode >= maxCode` 时递增），而非编码器的 post-increment `>`。

**原因**：编码器在"写入一码后、插入新条目时"递增（插入 2^w 后 nextCode=2^w+1 > 2^w）；解码器在"读取一码后、插入新条目时"递增，但解码器比编码器晚一个条目插入，因此必须用 `>=`（插入 2^w-1 后 nextCode=2^w >= 2^w 即递增），恰好补偿时差，使两边读写下一码时码宽一致。

**验证**：与 omggif（口碑 GIF 库）逐字节交叉验证，5 帧 48×48 高熵图像共 46,080 字节 RGBA，0 不匹配。隔行扫描 GIF 同样 0 不匹配。

### 2. 帧合成策略

- 维护单个 `Uint8ClampedArray(width*height*4)` 画布，初始全透明
- 每帧按 left/top/width/height blit（透明索引不覆盖画布）
- blit 后复制画布为该帧输出（完整 RGBA，非差分）
- disposal 2：blit 后清除该帧矩形区域为透明
- disposal 0/1/3：画布保留（3 按 1 处理）

### 3. 内存防护阈值

| 参数 | 值 | 理由 |
|------|-----|------|
| MAX_DIMENSION | 480px | 每帧 480×480×4 = 921KB RGBA；40 帧 ≈ 37MB |
| MAX_FRAMES | 40 | 覆盖绝大多数表情/动图（通常 <30 帧） |
| MAX_TOTAL_PIXELS | 480×480×40 ≈ 9.2M | 总 RGBA ≈ 37MB，中低端机小程序内存上限 ~128-256MB 内安全 |

文件头阶段即检查尺寸（读 bytes 6-9），避免解码超大 GIF 到内存后再拒绝。

### 4. 缩略图生成

- 单张隐藏 canvas（#thumbCanvas）顺序生成，避免并发内存峰值
- 最近邻降采样到 ≤120px
- `wx.canvasToTempFilePath` 导出 PNG 临时文件
- canvas 不可用时降级为空路径（列表显示占位背景）

### 5. 预览实现

- 可见 canvas（#previewCanvas）逐帧 putImageData
- setTimeout 链按 delayMs/speed 播放，循环
- 调速 0.5x（delay×2）、1x、2x（delay÷2），最小 20ms

## 验证证据

### 解码器自测（`node scripts/gif-decoder.test.js`）
```
=== GIF Decoder Tests ===
[1] 基本 GCT 解码
[2] 局部颜色表（LCT 优先于 GCT）
[3] 透明索引（alpha=0）
[4] 隔行扫描（interlace）
[5a] disposal 1（帧叠加）
[5b] disposal 2（恢复背景）
[5c] disposal 2 局部帧清除
[6] 帧延迟换算
[7] NETSCAPE 循环计数
[8] 非法输入 throw
[9] decode → buildGIF → decode round-trip（单帧）
[10] 多帧 round-trip（跨码宽 9→10→11→12）
[11] GIF87a 头支持
[12] 多帧透明叠加（disposal 1）
[13] 帧序号连续性

=== Results ===
PASS: 87
FAIL: 0
✓ All tests passed.
```

### omggif 交叉验证
```
Frames: 5 | Mismatched bytes: 0 / 46080
CROSS-VALIDATION: PERFECT MATCH
```
隔行扫描 GIF 交叉验证：`PERFECT MATCH (1024 bytes)`

### 语法检查
```
node -c utils/gif-decoder.js → OK
node -c pages/gifEditor/gifEditor.js → OK
node -c pages/index/index.js → OK
```

### 首页注册验证
```
app.json:32: "pages/gifEditor/gifEditor"
index.js:31: gifEditor: '2026-09-06'
index.js:283: id: 'gifEditor'
index.wxss:1362: .icon-gifEditor
```

### 设计 token 检查
- gifEditor.wxss 全部使用 `var(--color-*)`、`var(--space-*)`、`var(--radius-*)`、`var(--gradient-*)`、`var(--shadow-*)`、`var(--font-family-*)`
- 无硬编码 hex 色值（rgba 透明度为设计系统允许的写法，与 makeGif.wxss 一致）
- button 文案均单行
