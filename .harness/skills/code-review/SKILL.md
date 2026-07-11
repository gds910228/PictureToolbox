---
name: code-review
source: superpowers:requesting-code-review (code-reviewer.md)
harness_phase: 阶段四 / 阶段八-步骤4 编码评审
---

# 代码检查（Code Review）

> 源自 superpowers `requesting-code-review` 的 code-reviewer.md 模板，按本项目改造为静态检查清单。

## 触发场景

编码后、merge 前，或 expert-reviewer 派 reviewer 时加载此清单。聚焦静态检查（风格 / 安全 / 性能 / 正确性），不重复 expert-reviewer 的 spec 合规判断。

## 派 reviewer 方式

```bash
BASE_SHA=$(git rev-parse <任务前commit>)
HEAD_SHA=$(git rev-parse HEAD)
```
派 general-purpose subagent，给：diff 范围 + spec 需求 + 本清单。要求返回结构化发现（严重度 + 问题 + 建议 + 位置）。把 diff 落成文件交给 reviewer，别贴进自己上下文。

## 静态检查清单

### 风格
- 颜色是否用设计 token（`--color-*` / `--gradient-*`），无 ad-hoc hex？
- button 文案是否单行（全局 button 强制 flex + nowrap，长了溢出）？
- 是否复用现有 utils，而非重造（image-process / content-check 等）？

### 安全
- `pages/` 下有无 `SECRET_ID` / `SECRET_KEY` / 硬编码密钥？（必须零）
- 密钥读取是否走 cloud-secret.js 优先级（env > local-config.json > placeholder 检测）？
- 内容安全是否双层（前端 guardImage/guardText + 服务端 assertImageSafe）？FAIL_OPEN 是否正确（仅确认违规拦，异常 allow）？
- imgSecCheck：图 >1MB 是否跳服务端检查（前端缩略图检查为主）？
- demo/mock 数据是否正确标注（`demo:true`/`mock:true`）；未配置 vs 配置后失败 是否分两路（不静默替 mock）？

### 性能
- 降采样保透明是否直绘原图到小画布（非 wx.compressImage）？
- 大图处理是否分块 / 用 makeCheckThumb 缩略图先查？
- GIF / 二进制编码是否用口碑库交叉验证过？

### 正确性（本项目高频坑）
- 云函数按北京日计数是否手动算（不能 `new Date()` 直接取 UTC 日）？
- Hunyuan 消息格式：多模态 `Contents` 数组 vs 纯文本 `Content` 字符串，多轮没混？
- AI 结构化输出是否 3-tier JSON parse？
- 限流 featureKey 是否每功能独立（不与其他功能共享额度）？rate_limit 集合缺失是否 catch 降级 pass？
- `dataset` 取出 index 是否 `Number()` 强转（否则 `0!=="0"` 严格比较失效）？
- bindtap 双用途 handler 是否 typeof 守卫（首参是事件对象非业务值）？
- `content-check.js` 的 `require('./image-process')` 是否懒加载在函数内？
- rebase / 大块交换后是否 grep 核验结构落地？

## 严重度

- **Critical**：会崩 / 安全漏洞 / 数据错（secret 泄露、限流失效、北京日算错、Hunyuan 格式错）。
- **Important**：功能缺陷 / 明显性能问题 / spec 偏差（FAIL_OPEN 写反、demo 未标注）。
- **Minor**：风格 / 可读性 / 小优化。

## 红线

- 不预判发现严重度（不在 dispatch prompt 写"最多 Minor" / "别报 X"）。
- 不让 reviewer 重跑 implementer 已跑的验证（看 implementer 报告的证据即可）。
- 发现 plan-mandated 缺陷（与 plan 文本冲突）-> 交用户裁决，不擅自否决。
