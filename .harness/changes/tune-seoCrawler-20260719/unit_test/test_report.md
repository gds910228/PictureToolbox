# 验证用例清单（[适配] 本项目无测试框架，手动验证路径）

对照 spec 第八节成功标准。前 3 条真机预览（HITL④，用户执行），后 2 条静态已过。

## 用例

### UC1：工具卡跳转正常（核心路径）
- 场景：首页点击任意可用工具卡。
- 操作：真机预览，点「智能抠图」「去水印」「PDF转图片」等卡。
- 预期：跳转到对应工具页，无报错。
- 怎么验证：真机点击观察页面切换。
- 看什么证据：Console 无 error；落地页 URL 正确。

### UC2：热门场景卡跳转 + 埋点
- 场景：首页点热门场景卡。
- 操作：真机点「抠图换背景」「PDF转图片」等场景卡。
- 预期：跳转对应页；`hot_scene_click` 埋点上报。
- 怎么验证：真机点击 + 看 Console 埋点日志（analytics.track）。
- 看什么证据：页面跳转 + Console 出现 hot_scene_click track。

### UC3：点击视觉反馈不回归
- 场景：navigator 改造后视觉。
- 操作：真机按住工具卡/场景卡。
- 预期：保留原 `:active` scale 变形反馈；**无** navigator 默认半透明遮罩叠加。
- 怎么验证：真机长按对比改造前后。
- 看什么证据：视觉只有 scale，无灰色遮罩层。

### UC4：sitemap 语法合法（静态，已过）
- 场景：微信开发者工具加载 sitemap.json。
- 预期：无 sitemap 报错；29 页全 allow。
- 证据：`node -e` 校验 rules.length===29，全部 well-formed allow，与 app.json 对齐无缺无余。✅ 已过

### UC5：handler 无 navigateTo 残留（静态，已过）
- 场景：onToolTap/onSceneTap 不再调 wx.navigateTo。
- 预期：index.js 内 `wx.navigateTo` 0 处。
- 证据：Grep `wx\.navigateTo` in index.js = No matches。✅ 已过

## 备注
- available=false 拦截分支：当前所有工具 available=true，无 false 卡可测；逻辑保留为防御，真机无法触发验证，依赖代码审查（onToolTap 保留 toast 拦截，navigator url 空串不跳转）。
