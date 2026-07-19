# tune-seoCrawler-20260719

- 类型：tune
- 创建：2026-07-19（北京）
- 状态：进行中（待真机预览 HITL④）

## 目标
对照微信官方《小程序搜索优化指南》落地可执行优化：首页 navigator 改造 + sitemap 覆盖最大化。

## 阶段进度
| 阶段 | 状态 | 评审轮次 | 产出物 |
|---|---|---|---|
| 1 需求分析 | ✅ | - | request_analysis/spec.md |
| 2 需求评审 | ⏭️ 跳过（小变更自检） | - | - |
| 3 编码实现 | ✅ | - | index.js / index.wxml / sitemap.json |
| 4 编码评审 | ✅ 自审 | - | 静态验证全过（见下） |
| 5 验证用例设计 | ✅ | - | unit_test/test_report.md |
| 6 验证用例评审 | ⏭️ 跳过（小变更） | - | - |
| 7 构建部署 | ⏳ | - | - |
| 8 预览验证 | ⏳ HITL④ | - | - |
| 9 部署验证 | ⏳ | - | - |
| 10 用户确认 | ⏳ HITL⑤ | - | - |

> 本变更纯前端+配置，无云函数/密钥/限流/内容安全，风险面窄。阶段2/6 评审降级为自检；阶段4 自审（变更小未派独立 reviewer subagent，如实记录）；保留阶段8 真机预览 HITL。

## 验证用例数
5 条：UC4/UC5 静态已过 ✅；UC1/UC2/UC3 待真机预览（HITL④）

### 静态验证证据（已过）
- index.js `wx.navigateTo` 残留：0 处（Grep No matches）
- index.wxml navigator 开/闭标签：2/2 配对
- 两个 bindtap（onToolTap 行81 / onSceneTap 行37）均落在 `<navigator>` 上
- sitemap.json：29 条全 well-formed allow，与 app.json 29 页完全对齐（无缺无余，node 校验）

## 关键决议
- HITL①（需求待决议）：已通过 AskUserQuestion 解决--sitemap 选「覆盖最大化」、缩略图选「暂不做」。navigator 改造为确定项。
- HITL②（spec 批准）：用户前置已定方向并指示"开始调整"，视为 spec 批准；spec 详见 request_analysis/spec.md。
- HITL③（编码评审）：自审通过（证据见上）。
- HITL④（预览验证）：待用户真机预览 UC1/UC2/UC3。
- HITL⑤（最终交付）：待验收。

## 附带提示（不在本次动手）
- `pages/aiEnhance/` 完整四件套未在 app.json 注册（2 commit 历史），疑似废弃功能，留待用户单独裁决。
- 分享/爬虫缩略图（onShareAppMessage imageUrl 为空）：本次按用户决策未做，后续单独处理。

## 产出物索引
- request_analysis/spec.md
- request_analysis/tasks.md
- unit_test/test_report.md

## 流程约定更新（本需求附带）
- 用户指示:此项目直接在 main 分支开发,不开功能分支/worktree。
- 已更新 Harness 文档:`开发流程规范.md`(分支策略段+红线)、`application-owner.md`(决策树/阶段3前置/质量把关/Must-not-do)、`coding-skill/SKILL.md`(红线)。
- 本需求 commit `0cc854d` 已从 `tune/seo-crawler-optimize` 分支 fast-forward 转移至 main,分支已删。
- memory 新增 `work-on-main-no-feature-branch`。
