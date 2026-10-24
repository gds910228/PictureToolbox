# fix-hunyuanOffline-tokenhub-20261024 — 混元下线迁移 TokenHub

- 类型：fix（外部依赖变更导致的线上故障修复）
- 创建：2026-10-24（北京）
- 状态：编码完成，待云端部署与真机验证（HITL④/⑤）

## 故障定性

线上日志（aiCaption，2026-10-24 00:29）：`TencentCloudSDKHttpException code:2000 该模型已下线，请根据迁移指南前往 TokenHub 平台体验最新模型服务`。
**性质：腾讯云平台侧变更，非本项目代码缺陷。** 官方迁移指南 cloud.tencent.com/document/product/1729/131925：混元全系旧模型下线，迁至「大模型服务平台 TokenHub」（OpenAI Chat Completions 兼容）。

## 受影响面（已盘点）

走 `Model:'hunyuan-vision'` ChatCompletions 的 **5 个云函数**：`aiCaption`（含 greeting 模式）、`aiImageChat`（图片问答）、`aiImageDescribe`（图片描述）、`analyzeImage`（压缩分析，compress 页依赖）、`aiTextToImage`（仅 enhancePrompt 辅助；生图本身走 aiart 产品不受影响）。
不受影响：aiMatting/aiStyleTransfer/aiUpscale/aiColorize/aiEraser/aiOCR（其他腾讯云产品线，TC3 签名，仍用原 TENCENTCLOUD_* 密钥）。

## 迁移方案

- 新链路：`https://tokenhub.tencentmaas.com/v1/chat/completions`，`Authorization: Bearer`，OpenAI 兼容（小写 role/content；含图轮 content 数组 `image_url + text`；图片支持公网 URL 与 data URL）。
- 模型：`hy-vision-2.0-instruct`（官方图片理解文档示例模型；hy3 语言模型不支持图片，勿混用）。
- 鉴权：新环境变量 **TOKENHUB_API_KEY**（TokenHub 控制台创建），占位符检测与 cloud-secret 同规则；旧 TENCENTCLOUD_* 保留给 TC3 产品。
- 新增 canonical 共享助手 `cloudfunctionTemplate/tokenhub.js`（内置 https、无新 npm 依赖；normalizeImageUrl 兜底裸 base64；错误体解析；60s 超时），按规则拷贝至 5 个函数目录。

## 改动清单

- 新增：`cloudfunctionTemplate/tokenhub.js` + 5 份副本（aiCaption/aiImageChat/aiImageDescribe/analyzeImage/aiTextToImage）
- 改造：上述 5 个 `index.js` 调用层（Contents→OpenAI content 数组、gate 由 `secret.getCredentials().available` 切到 `tokenhub.isConfigured()`、内部函数名 callHunyuanAPI→callVisionAPI）
- 文档：CLAUDE.md 技术栈/Cloud 分层/Integration 章节/函数解剖清单同步更新

## 验证证据（已执行）

- `node --check` 5 个 index.js 全过；canonical 与 5 副本 `cmp` 一致；无 HunyuanClient/裸 base64 残留
- tokenhub.js 实测：占位符 Key 判未配置 ✓；normalizeImageUrl ✓；**真实请求打通**（错误 Key 收到 TokenHub 标准 JSON 错误体"API Key does not exist"，证明端点/传输/错误解析全链路可用，仅缺有效 Key）

## 部署步骤（HITL④，开发者执行）

1. TokenHub 控制台开通服务（有免费体验额度，后付费按 token 计费）→ API Key 管理页创建 Key
2. 云开发控制台为 5 个函数（aiCaption / aiImageChat / aiImageDescribe / analyzeImage / aiTextToImage）设置环境变量 `TOKENHUB_API_KEY`；**不要删除原 TENCENTCLOUD_SECRET_ID/KEY**（aiart/OCR 等仍在用）
3. 开发者工具逐个右键「上传并部署：云端安装依赖」上述 5 个函数
4. 真机回归：智能配文（4 平台）、图片问答（首轮带图+追问）、图片描述（多风格）、图片压缩的智能分析、AI 文生图的"帮我写提示词"、今日问候"AI 帮我写"

## 验证用例

见 unit_test/test_report.md（12 条）。

## 关联问题：aiTextToImage 生图报 "SubmitTextToImageJob is not a function"

TokenHub 迁移回归时发现（2026-10-24 两次线上日志）。
**诊断修正记录**：第一次误判为"云端依赖缓存装到老版 SDK"并抬了版本下限；重部署后版本日志实证云端已是 4.1.331（最新）仍报错——真实根因：**SDK 4.1.x 已删除 aiart 产品的 SubmitTextToImageJob/QueryTextToImageJob（混元生图任务整体迁至 hunyuan 产品）**，装得越新越报错，旧版本下 lift 只是碰巧掩盖过问题。
修复（对 4.1.331 实证方法存在性后迁移）：
- `newClient` 由 aiart 客户端换为 `hunyuan.v20230901.Client`；`SubmitTextToImageJob → SubmitHunyuanImageJob`、`QueryTextToImageJob → QueryHunyuanImageJob`（响应结构不变，RevisedPrompt 代码本就按数组处理）
- 参考图接口收窄：`Images` URL 数组 → 单个 `ContentImage:{ImageUrl}`；`MAX_REFERENCES` 3→1，前端上传器 maxCount 3→1、文案同步
- 合规字段保留：`LogoAdd:1`（AI 生成显式水印）、`Revise:1`（prompt 扩写）均显式传 1
- package.json 钉 `^4.1.331`（新方法依赖此版本线）；SDK 版本日志保留（再遇 "not a function" 先看版本）
教训：**"方法不存在"在腾讯云 SDK 语境下不只可能是版本太老，也可能是 API 迁移产品后被删除**——先用版本日志 + 本地安装同版本包 grep 客户端方法列表实证，再下结论。

### 第三轮（2026-10-24 10:08）：UnsupportedRegion

方法调通后报 `The action not support this region.`（code: UnsupportedRegion）。根因：**混元生图任务接口官方仅支持 ap-guangzhou 地域**（docs 1729/105969、110429），而全局 `TENCENTCLOUD_REGION` 是旧 aiart 多地域时代配置的。修复：`newClient` 内地域钉死 `ap-guangzhou`，与全局环境变量解耦（不影响其他产品的 region）。同轮日志确认 enhancePrompt（TokenHub 视觉模型写 prompt）已恢复正常（demo:false 真实输出）。

## 教训沉淀

- 外部模型服务生命周期要纳入监控：本次是"功能全挂才被动发现"。后续可在 secretCheck 云函数里加一个低频 TokenHub 探活（每 N 天一次），异常时前端能力降级提示——候选优化，未实施。
- 平台文档宣称的"兼容 OpenAI"仍需核对多模态子格式（image_url 嵌套结构），以图片理解专项文档为准。
