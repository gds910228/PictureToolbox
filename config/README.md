# 敏感配置管理说明

## 📋 配置文件结构

```
config/
├── cloud.example.json    # 配置模板（提交到git）
└── cloud.json           # 真实配置（不提交，已在.gitignore中）
```

## 🔐 安全机制

### 1. 敏感信息分离

- ✅ `cloud.example.json` - 包含配置结构和说明，可以提交到git
- ❌ `cloud.json` - 包含真实密钥，已在 `.gitignore` 中排除，不会被提交

### 2. .gitignore 配置

```gitignore
# 敏感配置文件（包含API密钥等）
config/cloud.json
config/*.json
!config/*.example.json
```

这确保：
- 真实配置 `cloud.json` 不会被提交
- 模板文件 `cloud.example.json` 可以提交
- 其他 `.json` 配置文件也会被排除

### 3. 云函数环境变量

云函数 `cloudfunctions/analyzeImage/config.json` 中也配置了相同的环境变量，用于云函数运行时读取。

**注意**：这个文件包含真实密钥，应该被 `.gitignore` 排除。当前为了部署方便，请在确认部署后立即删除或在 `.gitignore` 中添加：

```gitignore
# 云函数配置（包含敏感信息）
cloudfunctions/*/config.json
!cloudfunctions/*/config.example.json
```

## 🚀 快速开始

### 首次配置

1. **复制配置模板**
   ```bash
   cp config/cloud.example.json config/cloud.json
   ```

2. **编辑真实配置**
   ```json
   {
     "env": "cloud1-1gk79pjqd5e1ed35",
     "tencentCloud": {
       "secretId": "你的SecretId",
       "secretKey": "你的SecretKey",
       "region": "ap-guangzhou",
       "endpoint": "hunyuan.tencentcloudapi.com"
     }
   }
   ```

3. **验证配置是否被git忽略**
   ```bash
   git status
   ```
   应该**不会**看到 `config/cloud.json`

### 云函数配置

云函数的配置在 `cloudfunctions/analyzeImage/config.json`：

```json
{
  "permissions": {
    "openapi": []
  },
  "env": {
    "TENCENTCLOUD_SECRET_ID": "你的SecretId",
    "TENCENTCLOUD_SECRET_KEY": "你的SecretKey",
    "TENCENTCLOUD_REGION": "ap-guangzhou"
  }
}
```

**部署步骤**：
1. 打开微信开发者工具
2. 右键点击 `cloudfunctions/analyzeImage` 文件夹
3. 选择 **"上传并部署：云端安装依赖"**

## 🔍 配置验证

### 检查Git状态

```bash
# 查看哪些文件会被提交
git status

# 应该看到：
# config/cloud.example.json (可以提交)
# 不应该看到：
# config/cloud.json (已被忽略)
```

### 检查云函数日志

部署后，在微信开发者工具中：
1. 点击 **"云开发"** 按钮
2. 左侧菜单 → **"云函数"**
3. 找到 `analyzeImage` 函数
4. 点击 **"日志"** 查看运行日志

如果配置正确，日志中会显示：
- `开始分析图片`
- `调用混元API分析图片...`
- `混元API返回: {...}`

如果配置有误，会显示：
- `未配置API密钥，使用模拟实现`
- 或错误信息

## ⚠️ 安全注意事项

### DO's（应该做）

✅ 定期更换API密钥
✅ 为不同项目使用不同的密钥
✅ 在腾讯云控制台设置IP白名单
✅ 开启MFA（多因素认证）
✅ 监控API调用日志
✅ 设置费用告警阈值

### DON'Ts（不要做）

❌ 将 `config/cloud.json` 提交到git
❌ 在代码中硬编码密钥
❌ 在前端代码中使用密钥
❌ 与他人共享密钥
❌ 在公开场合展示密钥
❌ 将密钥写在文档或注释中

## 🔄 密钥泄露应急处理

如果怀疑密钥泄露：

1. **立即禁用泄露的密钥**
   - 登录腾讯云控制台
   - 访问密钥管理
   - 禁用或删除泄露的密钥

2. **创建新密钥**
   - 生成新的SecretId/SecretKey
   - 更新 `config/cloud.json`
   - 更新 `cloudfunctions/analyzeImage/config.json`
   - 重新部署云函数

3. **检查调用日志**
   - 查看API调用记录
   - 确认是否有异常调用
   - 评估损失并采取相应措施

## 📊 配置文件对比

### cloud.example.json（可分享）

```json
{
  "env": "cloud1-xxxxxxxxxxxx",
  "tencentCloud": {
    "secretId": "你的SecretId",
    "secretKey": "你的SecretKey",
    "region": "ap-guangzhou",
    "endpoint": "hunyuan.tencentcloudapi.com"
  }
}
```

### cloud.json（私密）

```json
{
  "env": "cloud1-你的环境ID",
  "tencentCloud": {
    "secretId": "替换为你的SecretId",
    "secretKey": "替换为你的SecretKey",
    "region": "ap-guangzhou",
    "endpoint": "hunyuan.tencentcloudapi.com"
  }
}
```

## 🎯 当前配置状态

✅ **已完成**：
- 配置文件模板创建
- .gitignore 更新（排除敏感配置）
- 云函数代码更新（支持真实API调用）
- 真实密钥配置到云函数环境变量

📋 **待完成**：
- 部署云函数
- 测试AI分析功能
- 验证配置正确性

## 📚 相关文档

- `混元API密钥获取指南.md` - 如何获取腾讯云API密钥
- `云开发配置快速指南.md` - 云开发环境配置
- `AI智能压缩-部署指南.md` - AI功能详细部署说明

---

**配置完成时间**：2026-01-22
**配置状态**：✅ 已完成，待部署测试
**下一步**：部署云函数并测试AI功能
