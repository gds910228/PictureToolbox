# 部署报告：GIF 编辑器最终能力包

- 日期：2026-09-06
- 类型：on-device（无云函数、无新依赖）

## 部署内容
- 新增 `scripts/gif-adaptive-test.js`（测试脚本，不打包）
- 修改 `utils/gif-encoder.js`（新增自适应调色板函数，旧函数不变）
- 修改 `pages/gifEditor/`（拆帧导出/信息面板/草稿/自适应开关）
- 修改 `pages/makeGif/`（底部引流链接，2 行）

## 部署步骤
1. 微信开发者工具打开项目
2. 确认无编译错误
3. 真机验证 V1-V14 手动用例
4. 重点：自适应调色板画质、拆帧导出、草稿恢复、makeGif 回归
5. 上传审核

## 回滚
- gif-encoder.js：删除新增的 5 个函数即可
- gifEditor.js：恢复上一版本
- makeGif：删除底部 navigator
