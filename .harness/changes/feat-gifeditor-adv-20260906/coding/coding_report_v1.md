# 编码报告：GIF 编辑器进阶能力包（v1）

- 日期：2026-09-06
- 状态：✅ 完成

## 变更文件

| 文件 | 类型 | 说明 |
|------|------|------|
| `utils/gif-frame-ops.js` | 新增 | 纯像素操作（~200 行，零 wx/canvas 依赖） |
| `scripts/gif-adv-test.js` | 新增 | 进阶编辑 node 自测（14 组，74 断言） |
| `pages/gifEditor/gifEditor.js` | 重写 | 4 模式切换：编辑/裁剪/文字/擦除；懒加载；进度反馈 |
| `pages/gifEditor/gifEditor.wxml` | 重写 | 模式 tab、裁剪覆盖层、文字面板、擦除控制、懒加载帧列表 |
| `pages/gifEditor/gifEditor.wxss` | 重写 | 新增模式/裁剪/文字/擦除样式，全设计 token |

## 一、utils/gif-frame-ops.js 纯函数

| 函数 | 功能 |
|------|------|
| `cropFrame(rgba, srcW, srcH, x, y, w, h)` | 裁剪帧，返回新 Uint8Array，自动 clamp 边界 |
| `cloneFrame(rgba)` | 深拷贝帧 |
| `eraseCircle(rgba, w, h, cx, cy, r)` | 圆形擦除（alpha=0），返回变化 bbox |
| `snapshotRect(rgba, w, h, x, y, rw, rh)` | 矩形快照（撤销用） |
| `restoreRect(rgba, w, snap)` | 恢复矩形快照 |
| `nineGridPosition(cw, ch, tw, th, pos, pad)` | 九宫格定位 |
| `measureText(text, fontSize, lineHeight)` | 文本测量（近似，不依赖 canvas） |

全部函数零 wx/canvas 依赖，可 node 直接测试。

## 二、页面架构

### 模式系统
- `data.mode`: 'edit' | 'crop' | 'text' | 'erase'
- 模式 tab 切换，非编辑模式暂停播放
- 每个模式有独立的控制区和画布交互

### 裁剪
- 裁剪框 4 角手柄 + 中央移动区，touch 事件拖拽
- 比例约束：选择比例时调整对边，自由模式无约束
- 坐标映射：CSS px ↔ canvas px 通过 `_canvasScale` 统一
- 确认：所有帧 `cropFrame`，保存 `_preCropSnapshot` 供撤销
- 撤销：恢复快照帧、尺寸、缩略图

### 文字
- 文字列表（scroll-view），点击编辑
- 属性：内容、字号、颜色（7 色设计 token 色板）、不透明度（slider）、描边（switch）
- 九宫格定位 + canvas 上拖拽微调
- 作用范围：全部帧 / 帧区间（picker 选择起止）
- 渲染：canvas `fillText`/`strokeText`，导出时逐帧烘焙到像素
- 差量编码自动检测文字区域像素变化，dirty-rect 覆盖文字 bbox

### 擦除
- 画笔 4/12/24px，touch 涂抹
- 线性插值避免快速滑动产生间隙
- 每帧独立 undoStack/redoStack（≤10 步，整帧快照）
- 帧切换时栈隔离，按钮状态更新
- 擦除修改 base frame rgba（alpha=0），文字在 canvas 上叠加不受影响

### 懒加载
- 解码后只生成前 8 帧缩略图（LAZY_THUMB_BATCH=8）
- scroll-view `bindscroll` 触发，接近末尾时加载下一批
- 帧列表中未加载的帧显示占位 "..."
- MAX_FRAMES 提升到 60（懒加载降低内存峰值）

### 进度反馈
- 解码：读取文件→解码帧→生成缩略图，分步进度 0→10→50→100
- 导出：逐帧合成文字（0-60%）→差量编码（65%）→写文件（90%）→完成（100%）

## 三、验证证据

### node 自测（scripts/gif-adv-test.js）
```
PASS: 74 / FAIL: 0
✓ All advanced editing tests passed.
```
覆盖：裁剪像素正确性、边界 clamp、全帧裁剪、深拷贝、圆形擦除、空擦除、撤销/重做、透明经 buildGIFDiff 保持、透明经 buildGIFDiff 单帧保持、裁剪后帧数/延时/尺寸、九宫格定位、文字测量、差量编码体积、裁剪+擦除组合。

### 全量回归
```
gif-decoder.test.js:  87 PASS / 0 FAIL
gif-adv-test.js:      74 PASS / 0 FAIL
gif-fuzz.js seed=7777:    200×3 = 600 PASS
gif-fuzz.js seed=31415:   200×3 = 600 PASS
gif-fuzz.js seed=271828:  200×3 = 600 PASS
```

### 透明 round-trip 验证（测试 8）
- 3 帧 32×32：蓝色→中心擦除透明→红色方块+透明中心
- buildGIFDiff 导出 → decodeGif 再解码
- 断言：帧 1/2 中心 alpha=0，边角 alpha=255 蓝色 ✅

### 裁剪 round-trip 验证（测试 10）
- 4 帧 64×64 → 裁剪 32×32 at (16,16) → buildGIFDiff → decode
- 断言：decoded.width=32, height=32, frameCount=4, 每帧 rgba.length=32×32×4, delayMs 不变 ✅

### 性能基准（无回归）
```
decodeGif 640×640×60: 511ms (≤2s) ✅
buildGIFDiff:         1.49s (≤5s) ✅
局部变化缩减:          70.7% (≥40%) ✅
全帧劣化:             0.0% (≤10%) ✅
```

## 四、设计 token 合规
- gifEditor.wxss 全部使用 `var(--color-*)`、`var(--space-*)`、`var(--radius-*)`、`var(--gradient-*)`、`var(--shadow-*)`
- 无硬编码 hex 色值（rgba 透明度与 makeGif 一致）
- button 文案单行
