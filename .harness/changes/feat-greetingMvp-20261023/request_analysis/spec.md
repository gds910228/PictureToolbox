# spec — feat-greetingMvp-20261023「今日问候」MVP

## 背景

决策链路：长辈每日发问候图到亲友群的行为（传播+粘度双闭环）→
`.harness/changes/analysis-greetingScene-20261023/summary.md` 落了验证口径 →
用户决策：跳过取数环节，直接按思路做 MVP，**硬约束：尽量不影响现有定位**。

## 定位红线（验收硬条件）

1. 首页工具箱身份不动：不加分组、不改 Banner/文案，只在**热门场景行 +1 卡**、**创意玩法组 +1 卡**（走既有 NEW 徽章自动机制）。
2. 全局赛博朋克主题零改动：问候页用**页面级浅色大字皮肤**（page 选择器局部覆盖，`page::before` 网格背景局部关闭），app.wxss 不动。
3. 无诱导分享：无任何"分享解锁/得次数"机制，成品图自然外流，尾签低调自带小程序名。
4. 新逻辑全部收进独立分包 `pkgGreeting`，主包只增 2 处入口声明。

## 功能范围（MVP）

- 流程三步：选照片（1-4 张，相册/拍摄）→ 挑样式 + 配祝福语 → 生成 1080×1440 问候图 → 发给亲友/保存相册/分享卡片。
- 样式 = 配置非素材：6 套浅色渐变模板（零版权风险、零包体）。每日新鲜感来自日期逻辑：时段（早安/日安/晚安）+ 2026 节日/节气表自动带出。
- 祝福语：本地祝福池（始终可用，无 AI 也完整）+ AI 写祝福（复用 aiCaption 云函数，`mode:'greeting'`，featureKey='caption' 既有独立限额，mock 态标「示例」）。
- 内容安全：选图 `guardImage`、文案 `guardText`（沿用标准化拦截，不暴露原因）。
- 分享落地归因：分享卡 `path` 带 `src=share&tpl=<id>`，落地页 onLoad 解析上报（补齐 analysis 文档 §5-3 缺口）。
- 埋点：`tool_view / greeting_landing / greeting_ai / greeting_render / greeting_save / greeting_share`（**需在公众平台登记事件名**）+ compare 页补齐 P0 埋点（analysis 文档 §5-1，32/33 页缺口）。

## 明确不做（MVP 边界）

GIF 问候 / 视频合成 / 订阅消息 / 模板后台化与运营台 / aiTextToImage 生成背景（成本）/ 长辈模式全站化。

## 技术要点

- 分包：`pkgGreeting/pages/greeting/*`，不进 preloadRule（保冷启动优化成果）。
- 渲染：Canvas 2D（node 内部分辨率 1080×1440），圆角裁切 + cover 适配 + CJK 逐字折行；导出 JPG q0.92。
- 发送：`wx.showShareImageMenu` 直发图片到会话（不可用时降级为保存相册+提示）；`onShareAppMessage` 卡片用成品图做封面。
- 云函数：aiCaption 加 `mode/greetingCtx` 入参，向后兼容（缺省 mode='social' 原行为不变）；greeting prompt 约束 ≤24 字口语化、长辈可读。

## 验证（本项目无自动化 → 手工用例，见 unit_test/test_report.md）

真机预览全流程 + 分享闭环 + 权限拒绝分支 + 限额/断网降级；云端需先重新部署 aiCaption。
