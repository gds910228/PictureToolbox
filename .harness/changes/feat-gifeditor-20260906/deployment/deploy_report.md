# 部署报告：GIF 编辑器

- 日期：2026-09-06
- 类型：on-device 功能（无云函数）

## 部署内容

| 项目 | 状态 | 说明 |
|------|------|------|
| 新增云函数 | 不涉及 | 纯 on-device，无云函数 |
| npm 依赖变更 | 无 | package.json 未修改，零新依赖 |
| 构建 npm | 不需要 | 无新 npm 依赖 |
| 小程序页面 | 新增 pages/gifEditor/ | 四件套已创建 |
| app.json pages[] | 已注册 | pages/gifEditor/gifEditor |
| 首页注册 | 已完成 | 4 处全部到位 |

## 部署步骤（人工执行）

1. 微信开发者工具打开项目根目录
2. 确认无编译错误（Console 无红色 error）
3. 预览 → 扫码真机验证（按 unit_test/test_report.md 用例执行）
4. 上传代码 → 提交审核

## 配置项

- 无 env vars
- 无 rate_limit（纯本地功能，不调云函数）
- 无云数据库集合
- 无 COS/CI 配置

## 回滚方案

删除以下文件/变更即可回滚：
- `utils/gif-decoder.js`
- `scripts/gif-decoder.test.js`
- `pages/gifEditor/` 整个目录
- `app.json` 中 pages/gifEditor/gifEditor 行
- `pages/index/index.js` 中 gifEditor 相关条目（tools[] + LAUNCH_DATES）
- `pages/index/index.wxss` 中 .icon-gifEditor 规则
