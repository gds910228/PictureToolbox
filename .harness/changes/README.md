# 变更管理

Harness SOP 阶段九产出物。每个需求建一个变更目录，全流程可追溯。

## 目录结构

每个需求在 `.harness/changes/` 下建：

```
{类型}-{需求名}-{YYYYMMDD}/
├── summary.md                 # 全流程追溯摘要（Single Source of Truth）
├── request_analysis/
│   ├── spec.md                # 需求分析文档
│   ├── tasks.md               # 任务拆分清单
│   └── review/                # 需求评审记录（版本递增，旧版永不删）
│       ├── spec_review_v1.md
│       └── spec_review_v2.md
├── coding/
│   ├── coding_report_v1.md    # 编码报告（含验证证据）
│   └── review/
│       └── code_review_v1.md  # 代码评审报告
├── unit_test/                 # [适配] 本项目为验证用例（非单测）
│   ├── test_report.md         # 验证用例清单 + 预期 + 证据要求
│   └── review/
├── ci_result/                 # [适配] 本项目为预览验证结果
│   └── ci_result.md
└── deployment/
    └── deploy_report.md
```

## 命名

- 类型：`feat`（新增）/ `fix`（修复）/ `tune`（调优），对齐现有 commit message 风格。
- 日期：`YYYYMMDD`（北京时区）。
- 示例：`feat-pdfToImage-20260710` / `fix-rateLimitBeijingDay-20260710` / `tune-homepageOrder-20260710`。

## 规则

- 评审文件**版本递增**（v1/v2/v3…），旧版**永不删**。
- `summary.md` 每阶段完成即更新，记录：执行状态、评审轮次、验证用例数、CI/部署结果。
- `summary.md` 是 SoT--compaction 后靠它 + `git log` + `.superpowers/sdd/progress.md` ledger 恢复进度。

## summary.md 模板

```markdown
# {变更名}

- 类型：feat/fix/tune
- 创建：YYYY-MM-DD（北京）
- 状态：进行中/已完成/已阻塞

## 阶段进度
| 阶段 | 状态 | 评审轮次 | 产出物 |
|---|---|---|---|
| 1 需求分析 | ✅ | - | request_analysis/spec.md |
| 2 需求评审 | ✅ | 2 | request_analysis/review/spec_review_v2.md |
| 3 编码实现 | ✅ | - | coding/coding_report_v1.md |
| 4 编码评审 | ✅ | 1 | coding/review/code_review_v1.md |
| 5 验证用例设计 | ✅ | - | unit_test/test_report.md |
| 6 验证用例评审 | ✅ | 1 | unit_test/review/ |
| 7 构建部署 | ✅ | - | deployment/deploy_report.md |
| 8 预览验证 | ✅ | - | ci_result/ci_result.md（N用例全过） |
| 9 部署验证 | ✅ | - | deployment/deploy_report.md（完整） |
| 10 用户确认 | ⏳ HITL⑤ | - | - |

## 验证用例数
{N} 条，全通过 / {M} 条待修

## 关键决议
- HITL①：{需求待决议内容与结论}
- HITL②：{spec 批准}
- HITL③：{编码评审通过}
- HITL④：{部署参数确认}
- HITL⑤：{最终交付}

## 产出物索引
（各阶段文件路径）

## 教训沉淀
（本需求发现的新坑 -> 已加进 Rules/memory 的指针）
```

## 与十阶段的对应

变更目录各子目录由 Application Owner（`.harness/agents/application-owner.md` 阶段四调度指令）在对应阶段自动创建并填充。HITL 确认点的决议记入 `summary.md`。
