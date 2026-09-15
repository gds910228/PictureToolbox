# 部署报告：GIF 引擎优化

- 日期：2026-09-06
- 类型：on-device 引擎优化（无云函数、无新依赖）

## 部署内容

| 项目 | 状态 | 说明 |
|------|------|------|
| 新增云函数 | 不涉及 | 纯 on-device |
| npm 依赖变更 | 无 | package.json 未修改 |
| 构建 npm | 不需要 | 无新依赖 |
| gif-encoder.js | 修改 | 新增 buildGIFDiff，buildGIF 不变 |
| gif-decoder.js | 修改 | 新增安全限制，公开接口不变 |
| gifEditor 页面 | 修改 | 导出改用 buildGIFDiff |
| 测试脚本 | 新增 | gif-fuzz.js、gif-bench.js（scripts/，不打包） |

## 部署步骤（人工执行）

1. 微信开发者工具打开项目根目录
2. 确认无编译错误
3. 预览 → 扫码真机验证
4. 重点验证：GIF 编辑器导出体积减小、播放正常
5. 回归验证：GIF 制作（makeGif）功能正常
6. 上传代码 → 提交审核

## 回滚方案

- `buildGIFDiff` 为新增函数，删除即可回滚
- `gifEditor.js` 中将 `buildGIFDiff` 改回 `buildGIF`（1 行）
- 解码器安全限制为防御性代码，不影响正常解码，无需回滚
