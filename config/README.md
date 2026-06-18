# 密钥与内容安全管理说明

> 本文档分两部分：
> 1. **密钥管理** —— 密钥只在微信云开发控制台的环境变量里，任何代码文件都不含真实密钥；各云函数通过统一的 `cloud-secret.js` 模块读取。
> 2. **内容安全** —— 所有用户上传图片 / 输入文字均经微信同步内容安全 API（`imgSecCheck` / `msgSecCheck`）检测，违规统一提示"含违规信息"、不暴露原因。

---

# 🔑 密钥管理

## 📁 目录结构

```
config/
├── cloud.example.json          # 模板（可提交 git）
├── cloud.json                  # 本地参考（已被 .gitignore 忽略，未进 git）
├── cloud.local.json.template   # 云函数本地调试回退配置模板（可提交 git）
└── README.md                   # 本文档
```

云函数侧（每个云函数各持一份相同副本，因微信云函数为隔离部署单元）：

```
cloudfunctionTemplate/cloud-secret.js              # canonical 源（单一事实来源）
cloudfunctions/<每个函数>/cloud-secret.js           # 与 canonical 字节一致
cloudfunctions/<每个函数>/local-config.json         # 本地调试密钥（gitignore，可选）
```

## 🔐 安全机制

### 1. 密钥只在控制台
真实 `SecretId` / `SecretKey` **只在**「微信云开发控制台 → 云函数 → 环境变量」为每个云函数设置：

| 变量名 | 说明 |
|---|---|
| `TENCENTCLOUD_SECRET_ID` | 腾讯云 SecretId（统一主变量名） |
| `TENCENTCLOUD_SECRET_KEY` | 腾讯云 SecretKey |
| `TENCENTCLOUD_REGION` | 地域，如 `ap-guangzhou` |

> 向后兼容：模块也认 `SECRET_ID` / `SECRET_KEY` / `API_REGION`，无需改动旧控制台配置。
> 占位符（`your_*` / `你的SecretId` / `_here` / 空值）一律视为「未配置」，不会拿去鉴权。

### 2. 统一读取模块 `cloud-secret.js`
所有 7 个业务云函数（analyzeImage / aiImageDescribe / aiCaption / aiMatting / aiStyleTransfer / aiImageEnhance / aiOCR）已改为：
```js
const secret = require('./cloud-secret');
const cred = secret.getCredentials();      // { secretId, secretKey, region, available }
// 或缺失即抛错：
secret.assertCredentials();
```
各函数原有的 mock / 抛错降级语义保持不变。

### 3. 本地调试回退（可选）
本地跑云函数时控制台变量可能不注入，可放置 `cloudfunctions/<函数>/local-config.json`（结构见 `cloud.local.json.template`）。该文件被 `.gitignore` 忽略，仅本地使用。

### 4. 启动安全检查 `secretCheck`
新增独立云函数 `secretCheck`，返回 `{ configured, hasSecretId, hasSecretKey, region }`（**不含任何密钥值**）。
`app.js` 启动时调用一次；若未配置，`console.warn` 提示管理员。首页 `pages/index/index.js` 也会轻量复查并告警。

## 🚀 部署步骤

1. 在微信开发者工具为 **8 个云函数**（含新增 `secretCheck`）逐一「上传并部署：云端安装依赖」。
2. 进入「云开发控制台 → 云函数 → 环境变量」，为每个函数设置 `TENCENTCLOUD_SECRET_ID` / `TENCENTCLOUD_SECRET_KEY` / `TENCENTCLOUD_REGION`。
   - 控制台值优先于各函数 `config.json` 里的占位符。
3. 在控制台「云函数」面板手动测试 `secretCheck`，应返回 `configured: true`。
4. 小程序启动后控制台应出现 `[安全检查] 云函数密钥配置正常`。

## ⚠️ 关于「git 历史」的澄清

经核实（`git log -S <SecretId>` / `git grep` 均为空）：**密钥从未被提交到 git 历史**，`config/cloud.json` 与 `cloudfunctions/*/config.json` 一直被 `.gitignore` 排除且未被跟踪。因此**无需** `git filter-branch` / BFG 清理历史。轮换密钥始终是好习惯，但非本任务必需。

## 🔄 密钥泄露应急

若怀疑泄露：登录腾讯云控制台 → 访问管理 → 禁用旧密钥 → 创建新密钥 → 在云开发控制台更新各云函数环境变量 → 重新部署 → 调 `secretCheck` 复核。

---

# 🔒 内容安全（图片 / 文字审核）

> 背景：提审被驳回，要求【上传图片】功能必须接入内容安全 API 且在所有可发布场景生效，检测到违规时**只提示"含违规信息"、不得暴露具体原因**。

## 方案要点

- **用同步接口**：图片 `security.imgSecCheck`、文字 `security.msgSecCheck`（经云函数 `cloud.openapi.security.*` 云调用）。
  - **不用** `media_check_async`（异步）：需提交者 openid + mp 后台配置回调 URL + 回调服务，且 5–30 分钟才出结果，与全站同步处理体验冲突。
- **全链路不回传原因**：云函数只返回 `{ safe: true/false }`，前端文案统一，满足"仅提示含违规信息"。
- **fail-open**：检测服务异常（限流/超时/未授权）时降级放行（`FAIL_OPEN=true` 常量可一键切严格），避免瞬时故障阻断所有正常用户。
- **缩图送检**：`imgSecCheck` 硬限制 **≤1MB / ≤750×1334px**，前端先用 canvas 缩到 ≤600px JPEG 0.6 再送检。

## 关键文件

| 文件 | 作用 |
|---|---|
| `cloudfunctions/checkImage/` | **唯一服务端集成点**：`mode:'image'`→imgSecCheck，`mode:'text'`→msgSecCheck；只返回 `{safe}`。 |
| `utils/content-check.js` | 前端：`guardImage(path)` / `guardText(text)`，违规弹标准化提示、异常降级放行。 |
| `utils/image-process.js` | `makeCheckThumb()`（缩图）；`chooseImage()` 内中心拦截（一处覆盖本地工具）。 |
| `cloudfunctionTemplate/content-check.js` | 服务端兜底 canonical 源（同 cloud-secret 的复制模块模式）。 |
| `cloudfunctions/<6个AI函数>/content-check.js` | 与 canonical 字节一致的副本：`assertImageSafe(buffer)`。 |

## 覆盖范围（共 13 个入口 + 6 个服务端检查）

- **前端 12 个图片入口**：
  - Path A（6 个 AI 页 aiCaption/aiDescribe/aiMatting/aiStyle/aiOCR/aiEnhance）：选图后 `guardImage`。
  - Path B（6 个本地页 compress/crop/convert/filter/watermark/splice）：注入 `imageProcess.chooseImage()`，一处覆盖。
- **前端 1 个文字入口**：水印页 `startAddWatermark()` 的 `guardText`（本 App 唯一 UGC 文本，无评论/发帖/简介）。
- **服务端 6 个 AI 云函数兜底**：analyzeImage / aiCaption / aiImageDescribe / aiMatting / aiStyleTransfer / aiOCR —— 下载图片后、处理前 `assertImageSafe`，违规抛错（防前端绕过）。

> `aiImageEnhance` 为桩函数（不处理图片），仅前端拦截；`checkImage` / `secretCheck` 不处理业务图片。

## openapi 权限（重要）

`imgSecCheck` / `msgSecCheck` 需在云函数 `config.json` 声明：

```json
{ "permissions": { "openapi": ["security.imgSecCheck", "security.msgSecCheck"] } }
```

- `checkImage/config.json` 含两项；6 个 AI 函数 `config.json` 含 `security.imgSecCheck`。
- ⚠️ `config.json` 被 `.gitignore` 忽略（与密钥同策略，属本地部署产物）。**部署后务必在「云开发控制台 → 云函数 → 权限」确认这两项已生效**——未授权时检测会走 fail-open 降级放行。

## 部署步骤（微信开发者工具）

1. 新建并「上传并部署：云端安装依赖」`checkImage`。
2. 6 个 AI 云函数（含新增的 `content-check.js`）改动后**重新部署**。
3. 控制台确认 `imgSecCheck` / `msgSecCheck` openapi 权限已授权。
4. **全程无需** mp 后台配置回调 URL（同步接口）。

## 验证

- 选明显违规图片：12 个工具逐一应弹「图片可能包含违规内容，请更换后重试」，**不显示任何原因/label**，图不进入处理。
- 水印页输入敏感文字 → 弹「文字内容可能违规，请修改后重试」，不烧进图。
- 正常图片 / 文字全流程不受影响（AI 处理、本地处理、保存相册）。
- 控制台手测 `checkImage`：`{mode:'image', base64:'<正常图base64>'}` → `{safe:true}`。

