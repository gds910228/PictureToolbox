---
name: deploy-verify
source: 自建（理念源自 superpowers:verification-before-completion + 项目部署流程）
harness_phase: 阶段四 / 阶段八-步骤9 部署验证
---

# 部署验证（Deploy Verify）

> 自建 skill。本项目无 CI/CD，部署 = 微信开发者工具手动上传 + 真机预览。理念源自 verification-before-completion。

## 触发场景

编码评审通过后，部署到云开发环境并端到端验证。

## 前置：部署参数确认

部署前逐项核对（缺一项都可能线上故障）：

- [ ] 云环境：`cloud1-1gk79pjqd5e1ed35`（app.js）
- [ ] 云函数 env vars：`TENCENTCLOUD_SECRET_ID` / `TENCENTCLOUD_SECRET_KEY` / `TENCENTCLOUD_REGION`（或旧名 SECRET_ID/SECRET_KEY/API_REGION）
- [ ] 限流 env：`RATE_LIMIT_DAILY`（不设则默认 20）
- [ ] `rate_limit` 集合已手动建（云开发控制台 -> 数据库；云函数 add 文档但不能建集合）
- [ ] 涉及 CI（pdfToImage 等）：COS 桶 + CI 已开通 + CAM 授权
- [ ] 新云函数的三件套齐全（cloud-secret.js / content-check.js / rate-limiter.js，从 cloudfunctionTemplate/ 复制）

## 端到端验证步骤

1. **构建 npm**（若有依赖变更）：微信开发者工具 -> 工具 -> 构建 npm。失败则停。
2. **上传部署云函数**：右键 cloudfunctions/<name>/ -> 上传并部署：云端安装依赖。部署后看云函数日志无启动报错。
3. **预览真机**：预览 -> 扫码。真机走一遍核心路径。
4. **日志检查**：开发者工具 Console 无 error；云开发控制台 -> 云函数日志无异常；若限流，查 rate_limit 文档计数符合预期。
5. **配置核对**：
   - secretCheck 返回的 `globalData.secretConfigured` 是否符合预期（true=已配密钥，false=未配走 demo）
   - AI 功能在真实密钥下返回非 demo（若 secretConfigured=true）
   - 内容安全：违规输入被拦，正常输入通过（异常 FAIL_OPEN 不误拦）
6. **降级路径**：未配密钥时 UI 正确标注"示例"，不崩。

## 产出物

`.harness/changes/{变更名}/deployment/deploy_report.md`：

```markdown
## 部署报告
部署时间: {YYYY-MM-DD HH:mm 北京}
云环境: cloud1-1gk79pjqd5e1ed35
部署云函数: {列表}
env vars 核对: ✅/❌
rate_limit 集合: ✅/❌

端到端验证:
- 构建 npm: ✅
- 云函数部署: ✅（日志无报错）
- 真机核心路径: ✅（{路径描述}）
- Console/云日志: ✅ 无 error
- 限流计数: ✅（{featureKey} 已 inc）
- 内容安全: ✅（违规拦 / 正常过）
- 降级标注: ✅（未配密钥显"示例"）

结论: 部署成功 / 需修复
```

## 红线

- 不跳参数核对直接部署。
- 不只看"上传成功"就声称部署完成--必须真机 + 日志双确认。
- secretConfigured 与 AI 返回一致性必须核对（声称"AI 可用"却实际走 demo = 假完成）。
- 部署后每个阶段更新 summary.md（Harness SOP 阶段九）。
