# 需求规格：GIF 编辑器（gifEditor）

- 类型：feat
- 创建：2026-09-06（北京）
- 执行层：**on-device**（纯本地，无云函数、无 npm 新依赖）

## 1. 需求概述

在「创意玩法」分组新增「GIF 编辑器」，补齐与「GIF制作」（多图合成）反向的能力：把一张已有 GIF 解开、逐帧编辑、再导出。全程本地处理，不联网。

## 2. 功能范围

### 2.1 GIF 解码器（utils/gif-decoder.js）

**接口契约（严格遵守）：**
```js
module.exports = { decodeGif };
decodeGif(arrayBuffer) → {
  width, height, loopCount, frameCount,
  frames: [{ index, delayMs, disposal, rgba: Uint8Array(width*height*4) }]
}
```
- `rgba` 为按 disposal 规则合成后的**完整画布帧**（透明区域 alpha=0）
- 非法输入 `throw Error` 并带原因
- 不依赖 wx API（可被 node 直接 require 测试）

**必须正确处理：**
- GIF89a / GIF87a 文件头
- 全局颜色表（GCT）+ 局部颜色表（LCT），LCT 优先
- 透明索引（GCE transparent color flag + index）
- 隔行扫描（interlace 四趟还原）
- disposal 0/1/2（3 罕见，按 1 处理）
- 帧延迟：GIF 内部 1/100 秒 → `delayMs`（×10）
- NETSCAPE2.0 / ANIMEXTS1.0 循环计数
- LZW 解压缩（minCodeSize 2..8，码宽 3..12，LSB-first）

### 2.2 编辑器页面（pages/gifEditor/ 四件套）

1. **选图**：`wx.chooseMessageFile` 从会话文件选 .gif；读取后校验 GIF8 文件头；相册转码 JPG 须友好报错。
2. **帧列表**：缩略图 + 帧号 + 延时；支持多选删除、区间截取（保留第 a~b 帧）、倒放（帧序反转）、调速（0.5x/1x/2x 修改 delay）。
3. **预览**：编辑后实时预览动图效果（canvas 逐帧渲染 + setTimeout 按 delay 播放）。
4. **导出**：编辑后的帧序列走 `utils/gif-encoder.js` 的 `buildGIF` 重新编码；保存与分享参照 `pages/makeGif/makeGif.js`。
5. **防护**：帧数/画布过大时提示或限制（MAX_DIMENSION=480px, MAX_FRAMES=40, 总像素预算 480×480×40）。

### 2.3 首页注册（4 处）
- `app.json` pages[] 追加 `pages/gifEditor/gifEditor`
- `pages/index/index.js` creative 组 tools[] 在 makeGif 之后插入 gifEditor
- `LAUNCH_DATES['gifEditor'] = '2026-09-06'`
- `pages/index/index.wxss` 增加 `.icon-gifEditor`（::before/::after 模式）

## 3. 设计约束
- 严格使用 app.wxss 设计 token（--color-*, --space-*, --radius-*），不引入硬编码色值
- button 文案保持单行
- 页面风格与 pages/makeGif 一致
- utils 引擎不依赖 wx API
- 不破坏 pages/makeGif 及其他存量功能

## 4. 验证标准
- `node scripts/gif-decoder.test.js` 直接跑通，输出 PASS 结果
- 覆盖全部语法特性 + decode→buildGIF→decode round-trip
- 解码器与 omggif（口碑库）交叉验证：同一张 GIF 逐字节 RGBA 一致
- 非法输入 throw 带原因
- 首页 4 处注册齐全
- JS 语法检查通过（node -c）
- JSON 文件合法

## 5. 范围外（YAGNI）
- 不做单帧像素级编辑（涂鸦/裁剪/滤镜）
- 不做 GIF 水印/字幕
- 不做云函数
- disposal 3（restore to previous）按 1 处理，不实现完整恢复
- 不做自适应色板（编码器沿用固定 6×6×6 色板）
