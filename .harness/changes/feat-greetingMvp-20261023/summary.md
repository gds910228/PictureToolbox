# feat-greetingMvp-20261023「今日问候」MVP

- 类型：feat
- 创建：2026-10-23（北京）
- 状态：编码完成，待真机验证（阶段 8）与云端部署（阶段 7 由开发者在开发者工具执行）

## 背景与决策链

长辈每日发问候图到亲友群的行为同时解决"传播弱（输出即传播）+ 粘度低（日历驱动回访）"。
前置分析见 `.harness/changes/analysis-greetingScene-20261023/summary.md`；
用户决策（HITL①，本对话）：跳过取数验证，直接实现 MVP，硬约束"尽量不影响当前定位"。

## 阶段进度

| 阶段 | 状态 | 评审轮次 | 产出物 |
|---|---|---|---|
| 1 需求分析 | ✅ | - | request_analysis/spec.md |
| 2 需求评审 | ✅ | 1（自审 + HITL① 用户批准方向与定位红线） | request_analysis/spec.md |
| 3 编码实现 | ✅ | - | coding/coding_report_v1.md |
| 4 编码评审 | ✅ | 1（自审：调用点一致性/引用路径/语法与数据逻辑验证） | coding/coding_report_v1.md |
| 5 验证用例设计 | ✅ | - | unit_test/test_report.md（29 条） |
| 6 验证用例评审 | ✅ | 1（自审） | unit_test/test_report.md |
| 7 构建部署 | ⏳ HITL④ | - | 需开发者工具：aiCaption 右键上传部署 + 后台登记 5 个事件名 |
| 8 预览验证 | ⏳ | - | 29 条手工用例待真机执行 |
| 9 部署验证 | ⏳ | - | - |
| 10 用户确认 | ⏳ HITL⑤ | - | - |

## 验证用例数

29 条（test_report.md），静态可验证项已过（见 coding_report_v1.md），其余待真机。

## 关键决议

- HITL①（用户对话决议）：跳过 analysis 文档的取数验证步骤，直接做 MVP；定位红线四条入 spec。
- 2026-10-24 微调：热门场景行移除「PDF转图片」（7 卡在 3 列网格末行空 2 位），回到 6 卡 3×2 整齐布局；该工具在"基础处理"分组入口不变。
- 2026-10-24 迭代（用户反馈）：底色 #FFF9F0→#FAEDDB 奶油/宣纸色 + 顶部氛围带（按 occasionType 变色：节日红金/节气青绿/平常暖橙）；祝福池扩容（每时段 6→12 条，新增节日/节气场合池各 6 条，场合池前置），默认句按日期种子轮换（跨天不同、当天稳定），新增「🎲 换一句」随机按钮（排除当前句）。
- 形态决议：问候 = 工具箱上的场景入口（热门场景卡 + 创意玩法卡），不做问候图门户、不动全局主题；页面级浅色大字皮肤局部覆盖。
- 技术决议：模板 = 配置非素材（零版权/零包体）；AI 配文复用 aiCaption 加 mode 分支（featureKey 仍 'caption'）；本地祝福池兜底保证无 AI 完整可用；showShareImageMenu 直发图片为主路径、卡片分享带 src=share 落地归因。

## 产出物索引

- request_analysis/spec.md / coding/coding_report_v1.md / unit_test/test_report.md
- 代码：pkgGreeting/*（新）、app.json、pages/index/index.{js,wxss}、cloudfunctions/aiCaption/index.js、pages/compare/compare.js

## 教训沉淀

- （待真机验证后回填）
