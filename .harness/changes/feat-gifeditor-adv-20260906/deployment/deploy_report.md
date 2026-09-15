# 部署报告：GIF 编辑器进阶能力包

- 日期：2026-09-06
- 类型：on-device（无云函数、无新依赖）

## 部署内容
- 新增 `utils/gif-frame-ops.js`（纯像素操作）
- 新增 `scripts/gif-adv-test.js`（node 自测）
- 重写 `pages/gifEditor/gifEditor.{js,wxml,wxss}`（4 模式编辑）
- 无 npm 依赖变更、无云函数、无配置变更

## 部署步骤
1. 微信开发者工具打开项目
2. 确认无编译错误
3. 真机验证 V1-V17 手动用例
4. 重点：裁剪/文字/擦除交互、透明导出、大 GIF 滚动性能
5. 上传审核

## 回滚
- `pages/gifEditor/` 恢复上一版本（git checkout）
- 删除 `utils/gif-frame-ops.js` 和 `scripts/gif-adv-test.js`
- 引擎（gif-encoder.js / gif-decoder.js）未修改，无需回滚
