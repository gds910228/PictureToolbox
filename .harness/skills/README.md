# Skills 技能体系

本目录是 Harness SOP 阶段四的产出物。skill 借鉴自 [obra/superpowers](https://github.com/obra/superpowers)（开源），按本项目「图个简单」微信小程序的特点改造。

## 改造原则

- **不照搬原文**，提炼成项目特定精简 SOP。
- 每个 skill = `SKILL.md` 主文档（触发场景 / 输入 / 执行步骤 / 本项目适配 / 产出物 / 红线）+ 必要模板。
- 顶部 frontmatter 标注 superpowers 源 skill + Harness 阶段映射。
- 「本项目适配」锚定真实结构：`pages/`、`utils/`、`cloudfunctions/`、`cloudfunctionTemplate/`、微信开发者工具、设计 token、on-device / cloud 双层架构。

## Skill 清单与映射

| Harness skill | superpowers 源 | 触发场景 | 加载时机 |
|---|---|---|---|
| request-analysis | brainstorming + writing-plans | 接到需求，动手前 | L2 阶段触发 |
| coding-skill | writing-plans + subagent-driven-development | spec 批准后编码 | L2 阶段触发 |
| expert-reviewer | requesting-code-review + receiving-code-review | 计划评审 / 编码后 / merge 前 | L2 阶段触发 |
| code-review | requesting-code-review (code-reviewer.md) | 静态检查 | L2 阶段触发 |
| systematic-debugging | systematic-debugging | 遇 bug / 失败 / 异常行为 | L2 按需 |
| verification-before-completion | verification-before-completion | 声称完成前 | L1 常驻（铁律） |
| deploy-verify | 自建（理念源自 verification-before-completion） | 部署验证阶段 | L2 阶段触发 |

## 上下文分层（对齐 Harness SOP 阶段七）

- **L1 常驻**：三份 Rules（`.harness/rules/`）+ `verification-before-completion` 铁律 + `CLAUDE.md`（每次会话开始）。
- **L2 阶段触发**：当前阶段对应 skill（如编码阶段加载 `coding-skill`）。
- **L3 按需查询**：wiki 知识库（阶段六，暂未建）+ memory。

## 目录结构

```
.harness/skills/
├── README.md                          # 本文件
├── request-analysis/SKILL.md
├── coding-skill/SKILL.md
├── expert-reviewer/SKILL.md
├── code-review/SKILL.md
├── systematic-debugging/SKILL.md
├── verification-before-completion/SKILL.md
└── deploy-verify/SKILL.md
```

## 砍掉的 Harness 表项目（本项目不适配）

| Harness 项 | 处理 | 原因 |
|---|---|---|
| unit-test-write | 砍 | 无测试框架，TDD 红绿循环落不了地 |
| unit-test-ci | 砍 | 无 CI |
| aone-ci-generate | 砍 | aone 是阿里内部 CI 系统；本项目无 CI |
| project-analysis | 暂不另建 | superpowers 无对应；`CLAUDE.md` 已是极详尽架构索引，暂代 |

> `test-driven-development` 的理念（先想清验证方式）保留进 `verification-before-completion`，但不作为独立 skill。

## 与 superpowers 的关系

superpowers 是素材库，本目录是项目内化资产。引用原 skill 的方法论骨架，但步骤、检查项、验证命令全部项目化。原 skill 版权归 obra，遵循其 LICENSE。
