---
name: request-analysis
source: superpowers:brainstorming + superpowers:writing-plans
harness_phase: 阶段四 / 阶段八-步骤1 需求分析
---

# 需求分析（Request Analysis）

> 源自 superpowers `brainstorming`（发散探索）+ `writing-plans`（拆任务），按本项目改造。

## 触发场景

接到任何新需求 / 新功能 / 行为改动时，**动手写码前**必须先走此 skill。

## 铁律（HARD-GATE）

设计未获用户批准前，不写任何实现代码、不建项目骨架、不调任何实现 skill。再简单的需求也要先出设计（简单需求设计可短至几句话）。"太简单不用设计"是反模式——简单处正是未检假设最浪费工的地方。

## 输入

用户的一句话需求 + 当前项目状态（CLAUDE.md、相关 pages/utils/cloudfunctions、近期 commit）。

## 执行步骤

1. **探项目上下文**：读 CLAUDE.md、相关文件、近期 commit。先看现有结构再提改动，遵循现有模式。
2. **一次一个澄清问题**（优先选择题）。至少覆盖下方【本项目必问清单】。
3. **提 2-3 个方案**，带取舍，给出推荐 + 理由。
4. **分段呈现设计**：架构 / 组件 / 数据流 / 错误处理 / 验证方式。每段问用户"这样对吗"。
5. **写 spec.md**：存到 `.harness/changes/{变更名}/request_analysis/spec.md`（变更名 = `{类型}-{需求}-{YYYYMMDD}`）。
6. **spec 自检**：占位符扫描（TBD/TODO）、内部一致性、范围（是否需拆子项目）、歧义。就地修。
7. **用户 review spec**：请用户审 spec 文件，有改就改 + 重自检，批准后才继续。
8. **转 coding-skill**：用 coding-skill 把 spec 拆成 tasks.md 并执行。本 skill 终态 = 触发 coding-skill。

## 本项目必问清单（澄清问题至少覆盖）

- **执行层**：on-device（`utils/` 引擎）还是 cloud（`cloudfunctions/` + Hunyuan）？能 on-device 就不上云——隐私 / 成本 / 失败特征都不同。
- **页面注册**：是否新建 page？若是，需同步 4 处：`pages/<name>/` 四件套、`app.json` pages[]、`index.js` data.groups 注册、`LAUNCH_DATES` 加 NEW 徽章；可能还要 `index.wxss` 加 `.icon-<id>`。
- **云函数**：是否新建云函数？若是，必须从 `cloudfunctionTemplate/` 复制三件套（cloud-secret.js / content-check.js / rate-limiter.js）——云函数不能跨目录 require。
- **限流**：是否需要限流？定 `featureKey`（每功能独立 20 次/日，不共享）；`rate_limit` 集合须手动建。
- **密钥**：是否调腾讯云？SecretId/Key 绝不入前端，走云函数 env vars；未配置时返回 `demo:true`/`mock:true` 标注"示例"。
- **内容安全**：图片/文字是否过安全检查？前端 `guardImage/guardText` + 服务端 `assertImageSafe` 双层，FAIL_OPEN（仅确认违规才拦）。
- **设计**：是否用设计 token（非自定义 hex）？button 文案能否单行？
- **成功标准**：怎么算完成？真机预览能跑通哪条路径？

## 产出物

- `.harness/changes/{变更名}/request_analysis/spec.md`
- `.harness/changes/{变更名}/request_analysis/tasks.md`（任务拆分，可由 coding-skill 细化）

## 红线

- 不跳过用户 spec review。
- 不在未探上下文前提问。
- 不把多独立子系统塞一个 spec，先拆子项目，每个子项目各自 spec → plan → 实现。
- YAGNI：砍掉不必要功能。
