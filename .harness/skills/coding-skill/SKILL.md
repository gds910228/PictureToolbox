---
name: coding-skill
source: superpowers:writing-plans + superpowers:subagent-driven-development
harness_phase: 阶段四 / 阶段八-步骤3 编码实现
---

# 编码实现（Coding Skill）

> 源自 superpowers `writing-plans`（拆 bite-sized 任务）+ `subagent-driven-development`（逐任务 subagent + 评审），按本项目改造。

## 触发场景

spec.md 经用户批准后，进入编码实现。

## 输入

`.harness/changes/{变更名}/request_analysis/spec.md` + 用户批准。

## 三层结构（替代 Controller/Service/DAO/Adapter）

本项目按执行 tier 分层，不按技术层：

- **页面层** `pages/<name>/{.js,.json,.wxml,.wxss}`：原生四件套，无 UI 库。
- **on-device 引擎层** `utils/<name>.js`：Canvas 2D + 手写编码器，离线。
- **云函数层** `cloudfunctions/<name>/`：`index.js` + `cloud-secret.js` + `content-check.js` + `rate-limiter.js` + `package.json`。独立部署单元，不能跨目录 require，共享 helper 靠从 `cloudfunctionTemplate/` 复制。

## 硬约束清单（每条对应一个历史教训，编码时逐条对照）

- 云函数跑 UTC，按北京日计数须手动算：`new Date(Date.now()+8*3600*1000).toISOString().slice(0,10)`。
- `wx.compressImage` 强制 JPG 丢 alpha；保透明降采样要直绘原图到小画布。
- 蓝通道 LSB 隐写被 JPEG 4:2:0 抹平；抗 JPEG 须走 luma / DCT 域。
- 手写二进制格式（GIF LZW 等）须用口碑库交叉验证（LZW 码宽递增用 `>`、NETSCAPE2.0 魔数 11 字节）。
- Hunyuan 多模态消息用 `Contents` 数组，纯文本用 `Content` 字符串，多轮不可混。
- AI 结构化输出用 3-tier JSON parse（直解 → 去 ```` ```json ```` fence → 正则提 `[...]`），prompt 末尾加"只返回纯 JSON 字符串数组，不要 markdown 代码块"。
- 限流：`rate_limit` 集合手动建；featureKey 每功能独立；集合缺失 catch 降级 pass + console.error，不阻塞请求。
- Secret 不入前端（`pages/` 下不得出现 SECRET_ID/SECRET_KEY）；未配置返 demo/mock，配置后失败返 success:false，绝不静默替 mock。
- 内容安全双层 + FAIL_OPEN：服务异常降级 allow，仅确认违规拦；图 >1MB 跳服务端检查。
- 设计 token（app.wxss 声明），不引入 ad-hoc hex；button 文案单行（全局 button 强制 flex + nowrap）。
- rebase 后 grep 核验大块交换是否落地（exit 0 不代表结构改动生效）。
- `content-check.js` 里 `require('./image-process')` 必须懒加载在函数内，别提到模块顶（破循环依赖死锁）。

## 执行模式（二选一）

**A. Subagent-Driven（推荐，多任务时）**：每个任务派 fresh implementer subagent（只给任务 brief + 接口 + 全局约束，不给会话历史），实现后派 task-reviewer 评审（spec 合规 + 代码质量双判），Critical/Important 修完再下一个；全部完成后派最终 whole-branch reviewer。进度记 `.superpowers/sdd/progress.md` ledger，防 compaction 后重派已完成任务。
**B. Inline 执行（单任务 / 无 subagent）**：用 executing-plans 同会话执行，检查点处暂停 review。

## 任务粒度

每个任务 = 最小可独立验证单元，含自己的验证周期。步骤 bite-sized（2-5 分钟一步）：写码 → 跑验证 → 看输出 → commit。小步频繁提交。

## 产出物

- `.harness/changes/{变更名}/coding/coding_report_v1.md`（实现报告，**含验证证据**，非"应该过"）
- 代码 commit

## 红线

- 本项目直接在 main 分支开发（单人单仓约定），不开分支 / worktree。
- 不跳逐任务评审；评审报告必须双判（spec 合规 + 质量）。
- 不接受 implementer 自审代替独立评审。
- 不告诉 reviewer "别报 X"（预判发现是评审污染）。
- 实现前必须理解现有代码，不顺手无关重构。
- 声称完成前必须跑验证拿证据（见 verification-before-completion）。
