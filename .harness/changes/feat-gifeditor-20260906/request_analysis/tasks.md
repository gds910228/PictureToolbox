# 任务拆分：GIF 编辑器

| # | 任务 | 落位 | 依赖 | 验证方式 |
|---|------|------|------|----------|
| T1 | GIF 解码器（二进制解析+LZW+合成） | utils/gif-decoder.js | 无 | node 自测 + omggif 交叉验证 |
| T2 | 解码器自测脚本 | scripts/gif-decoder.test.js | T1 | `node scripts/gif-decoder.test.js` 全 PASS |
| T3 | 编辑器页面 JS（选图/解码/编辑/预览/导出） | pages/gifEditor/gifEditor.js | T1 | node -c 语法检查 + 手动验证用例 |
| T4 | 编辑器页面 WXML/WXSS/JSON | pages/gifEditor/gifEditor.{wxml,wxss,json} | T3 | 设计 token 检查 + 风格比对 makeGif |
| T5 | 首页注册 4 处 | app.json, index.js, index.wxss | T4 | grep 验证 |
| T6 | Harness 变更记录 | .harness/changes/feat-gifeditor-20260906/ | T1-T5 | 文件齐全 |

## 接口签名

### decodeGif(arrayBuffer)
```
→ { width:number, height:number, loopCount:number, frameCount:number,
    frames:[{ index:number, delayMs:number, disposal:number, rgba:Uint8Array }] }
```
- `rgba.length === width * height * 4`
- 透明像素 alpha=0
- 非法输入 throw Error(message)

### 页面数据流
- `this._frames`: 内部完整帧数据 `[{ rgba, delayMs, thumbPath }]`
- `data.frames`: 轻量显示数据 `[{ index, delayMs, thumbPath, selected }]`
- `_syncFrames()`: 从 _frames 同步到 data（含 frameLabels）
- 编辑操作（删除/截取/倒放/调速）修改 _frames 后调 _syncFrames()
- 导出时 `_frames.map(f => ({ width, height, rgba, delayCs }))` → buildGIF
