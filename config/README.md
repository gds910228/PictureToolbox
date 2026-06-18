# 密钥与配置管理说明

> 统一方案：**密钥只在微信云开发控制台的环境变量里**，任何代码文件都不含真实密钥。
> 各云函数通过统一的 `cloud-secret.js` 模块读取。

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
