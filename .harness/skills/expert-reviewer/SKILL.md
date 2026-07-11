---
name: expert-reviewer
source: superpowers:requesting-code-review + superpowers:receiving-code-review
harness_phase: 阶段四 / 阶段八-步骤2 需求评审 + 步骤4 编码评审
---

# 专家评审（Expert Reviewer）

> 源自 superpowers `requesting-code-review`（派 reviewer）+ `receiving-code-review`（回应反馈），按本项目改造。

## 触发场景

- **计划评审**：spec / tasks 出来后，动手前。
- **执行评审**：每个任务实现后、重大功能完成后、merge 前。
- 卡住时、复杂 bug 修完后（可选，借新鲜视角）。

## 评审方式

派独立 reviewer subagent，只给「要评审的 diff（BASE_SHA..HEAD_SHA）+ spec / 需求 + 全局约束」，**不给会话历史**（避免被实现思路带偏，保持客观）。reviewer 用 code-review skill 的检查清单。

## 计划评审检查项

- 是否覆盖 spec 全部需求（逐条对照，列 gap）？
- 三层结构落位对不对（page / utils / cloudfunction 哪层）？
- 硬约束清单是否都体现在任务里（限流 featureKey / 密钥 / 内容安全 / 北京日 / 设计 token）？
- 任务粒度是否独立可测？接口签名前后一致（同名函数别 Task3 叫 `clearLayers` Task7 变 `clearFullLayers`）？
- 有无占位符（TBD / TODO / "适当处理异常" / "参考 Task N"）？

## 执行评审检查项

- **spec 合规**：做了要求的，没多做（YAGNI），没漏做。
- **代码质量**：见 code-review skill 的静态清单。
- **验证证据**：implementer 是否真跑了验证（不是"应该过"）。

## 评审报告模板

```markdown
## 评审报告 v{N}
评审对象: {BASE_SHA}..{HEAD_SHA} / {文件范围}
spec 合规: ✅/❌（❌ 列 gap）
代码质量: ✅/❌

发现:
- [Critical] {问题} | {建议} | {位置}
- [Important] {问题} | {建议} | {位置}
- [Minor] {问题} | {建议} | {位置}

结论: APPROVED / 需修改后重审
```

存 `.harness/changes/{变更名}/coding/review/code_review_vN.md`（版本递增，旧版永不删）。

## 回应反馈（receiving）

- Critical：立即修。
- Important：继续前必修。
- Minor：记 progress ledger，最终 whole-branch review 时统一 triage。
- reviewer 错了：有理有据反驳（贴代码 / 测试证据），不强辩。
- 修完重审，不跳 re-review。

## 轮次约束（对齐 Harness SOP 阶段八）

- 需求评审最多 3 轮，编码 / 测试评审最多 2 轮，超出升级人工决策。

## 红线

- 不因"简单"跳评审。
- 不带 unfixed Critical / Important 进下一任务。
- 不预判 reviewer 发现的严重度（不在 dispatch 里写"最多 Minor"/"别报 X"）。
- plan-mandated 的发现（与 plan 文本冲突）交给用户裁决，不擅自否决也不擅自改。
