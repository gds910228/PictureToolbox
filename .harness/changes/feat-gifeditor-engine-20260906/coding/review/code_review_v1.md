# 代码评审 v1：GIF 引擎优化

- 日期：2026-09-06
- 结论：✅ APPROVED（Critical=0, Important=0, Minor=1）

## 评审范围

- `utils/gif-encoder.js`：新增 `buildGIFDiff`、`quantizeFull`、`quantizeDiff`、`hasErasure`、`findDirtyRect`
- `utils/gif-decoder.js`：新增 MAX_BLOCKS、LZW maxIterations 安全限制
- `scripts/gif-fuzz.js`：种子化 fuzz 生成器 + 三类属性测试
- `scripts/gif-bench.js`：性能基准 + 数据表
- `pages/gifEditor/gifEditor.js`：导出改用 buildGIFDiff

## 静态检查

| 检查项 | 结果 |
|--------|------|
| decodeGif 公开契约不变 | ✅ module.exports={decodeGif}，返回结构不变 |
| buildGIF 不修改 | ✅ makeGif 继续使用，函数体未变 |
| 零 wx 依赖（utils） | ✅ gif-encoder.js / gif-decoder.js 无 wx 引用 |
| 零 npm 新依赖 | ✅ package.json 未修改 |
| 设计 token | ✅ 页面样式无硬编码色值 |
| button 单行 | ✅ |
| 安全限制不影响正常解码 | ✅ MAX_BLOCKS=65536、maxIterations=pixelCount*4+8192，正常 GIF 远低于此 |
| 差量编码 round-trip | ✅ 0 像素差 >8（480×480×20 帧） |
| fuzz 1500 迭代 | ✅ 三类全 PASS |
| 性能达标 | ✅ decode 504ms, encode 1.44s |
| 语法检查 | ✅ node -c 全部通过 |

## 发现的问题（已在编码阶段修复）

编码过程中通过 fuzz 发现并修复 5 个 bug，详见 coding_report_v1.md。关键 bug：
- disposal=2 时序错误（设在当前帧而非前一帧）
- disposal=2 + dirty-rect 部分清除
- fuzz 生成器 transIndex 超出 LCT 范围

## Minor（待跟踪）

### Minor 1：差量编码在全帧变化时比全帧编码略慢
- **位置**：buildGIFDiff 全帧路径
- **说明**：全帧变化时 buildGIFDiff 需先做逐帧比较（findDirtyRect），再全帧量化，比直接 buildGIF 多一次遍历。640×640×60 帧约慢 12%（1.44s vs 1.28s），仍在 5s 目标内。
- **处理**：可接受，不优化。局部变化场景下 buildGIFDiff 反而更快（169ms vs 628ms）。
