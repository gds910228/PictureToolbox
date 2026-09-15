# 部署报告：GIF 工具链收官

- 日期：2026-09-06
- 类型：on-device（无云函数、无新依赖）

## 部署内容
- 新增 `utils/gif-compress.js`（压缩引擎）
- 新增 `utils/gif-effects.js`（帧特效）
- 新增 `scripts/gif-engine-test.js`（测试）
- 新增 `pages/gifBatch/`（批量处理页面）
- 修改 `utils/gif-decoder.js`（新增分块解码）
- 修改 `pages/gifEditor/`（压缩选项、分块解码）
- 修改 `pages/index/`（注册 gifBatch）
- 修改 `app.json`（注册路由）

## 部署步骤
1. 微信开发者工具打开项目
2. 确认无编译错误
3. 真机验证 V1-V12
4. 重点：批量处理、压缩、超大 GIF 流式解码
5. 上传审核

## 回滚
- 删除 pages/gifBatch/ 和相关注册
- gif-decoder.js 删除 decodeGifChunked
- gif-compress.js / gif-effects.js 为新增文件，删除即可
- gifEditor 压缩开关默认关闭
