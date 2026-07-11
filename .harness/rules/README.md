# Rules 规则体系

Harness SOP 阶段三产出物。不随需求变化的稳定约束，作为 Agent 常驻上下文（L1）。

## 三份规则

| 文件 | 范围 | 要点 |
|---|---|---|
| [工程结构.md](工程结构.md) | 模块划分、文件放置、路由 | flat 布局；三层 tier（pages/utils/cloudfunctions）；cloudfunctionTemplate 规范源；app.json/index.js 注册表 |
| [项目编码规范.md](项目编码规范.md) | 硬约束、命名、设计 | 时区限流/密钥降级/内容安全FAIL_OPEN/Hunyuan双格式/图像处理坑/前端交互坑/设计token；每条对应 memory 历史教训 |
| [开发流程规范.md](开发流程规范.md) | 需求到交付流程、分支、提交 | 无CLI全开发者工具；request-analysis->coding->review->deploy-verify；分支策略；入库边界；变更管理 |

## 与其他资产的关系

- **CLAUDE.md** = 详尽背景知识（叙述性）；本 Rules = 规则化约束（条目式 do/don't + 确切值），是其精华提炼，便于 L1 常驻。
- **`.harness/skills/`** = 阶段性 SOP（怎么做）；本 Rules = 跨阶段稳定约束（什么必须/禁止）。
- 二者配合：Rules 设底线，skills 定流程。

## 加载策略（对齐 SOP 阶段七）

- **L1 常驻**：三份 Rules + `verification-before-completion` 铁律 + CLAUDE.md（每次会话开始）。
- **L2 阶段触发**：当前阶段对应 skill。
- **L3 按需**：wiki / memory。

## 维护

- 发现新教训 -> 加进对应 Rules 一条 + 记 memory。
- 每条规则保持对应一个历史教训或稳定约束，不堆背景叙述。
- 每份控制在 50-100 行，精炼。
