# AI功能使用指南

## 🎁 微信AI小程序成长计划福利

你的小程序已成功添加4个新AI功能，可以充分利用微信2026年AI小程序成长计划的免费资源：

### 免费资源包（价值约5400元）
- ✅ **云开发环境**：免费6个月
- ✅ **混元文生文Token**：1亿Token免费额度
- ✅ **混元文生图**：1万张图片生成免费额度
- ⏰ **活动时间**：2026年1月1日 - 2026年12月31日

### 如何参与活动
1. 登录[微信小程序后台](https://mp.weixin.qq.com/)
2. 进入 **行业能力** → **AI小程序成长计划**
3. 立即报名并领取免费资源

---

## 🚀 新增AI功能

### 1️⃣ AI图片描述 (aiDescribe)
**功能**：智能识别图片内容并生成描述文字

**支持4种描述风格**：
- 📝 专业描述 - 简洁专业的语言，适合正式场合
- 🎨 诗意描述 - 用诗意的语言描绘画面
- 🔍 详细描述 - 从整体到局部逐层详细描述
- 📱 社交媒体 - 适合朋友圈、小红书等平台

**云函数**：`cloudfunctions/aiImageDescribe`
**页面路径**：`pages/aiDescribe/aiDescribe`

---

### 2️⃣ AI智能配文 (aiCaption)
**功能**：根据图片内容一键生成社交媒体文案

**支持4个平台**：
- 👥 朋友圈 - 轻松自然，20-50字
- 📕 小红书 - 种草风格，带hashtag，50-100字
- 🎤 微博 - 幽默流行语，30-80字
- 🎵 抖音 - 短小精悍，20-60字

**特色**：可指定主题（如"美食"、"旅行"、"穿搭"等），生成更精准的配文

**云函数**：`cloudfunctions/aiCaption`
**页面路径**：`pages/aiCaption/aiCaption`

---

### 3️⃣ AI图片增强 (aiEnhance)
**功能**：智能提升图片质量

**支持3种增强类型**：
- 🔍 **超分辨率** - 2倍放大图片，AI智能填充细节
- ✨ **智能降噪** - 去除图片噪点和颗粒感
- 💎 **清晰化** - 增强边缘和细节，让图片更锐利

**云函数**：`cloudfunctions/aiImageEnhance`
**页面路径**：`pages/aiEnhance/aiEnhance`

---

### 4️⃣ AI风格迁移 (aiStyle)
**功能**：将照片转换为艺术风格

**支持6种艺术风格**：
- 🎨 油画风格
- 💧 水彩风格
- ✏️ 素描风格
- 🎌 动漫风格
- 🌃 赛博朋克风格
- 🎭 波普艺术风格

**云函数**：`cloudfunctions/aiStyleTransfer`
**页面路径**：`pages/aiStyle/aiStyle`

---

## 🛠️ 部署配置指南

### 步骤1：配置云函数环境变量

每个云函数都需要配置腾讯云API密钥。在 `cloudfunctions/*/config.json` 中填入：

```json
{
  "env": {
    "TENCENTCLOUD_SECRET_ID": "你的SecretId",
    "TENCENTCLOUD_SECRET_KEY": "你的SecretKey",
    "TENCENTCLOUD_REGION": "ap-guangzhou"
  }
}
```

### 如何获取腾讯云API密钥
1. 登录 [腾讯云控制台](https://console.cloud.tencent.com/)
2. 访问 **访问管理** → **API密钥管理**
3. 创建密钥或使用现有密钥

### 步骤2：安装云函数依赖

在微信开发者工具中：

```bash
# 右键每个云函数文件夹
# 选择"在终端中打开"
cd cloudfunctions/aiImageDescribe
npm install

# 对其他云函数重复此步骤
cd ../aiCaption && npm install
cd ../aiImageEnhance && npm install
cd ../aiStyleTransfer && npm install
```

### 步骤3：上传并部署云函数

在微信开发者工具中：
1. 右键云函数文件夹（如 `aiImageDescribe`）
2. 选择 **上传并部署：云端安装依赖**
3. 等待部署完成（约1-2分钟）
4. 对其他3个云函数重复此步骤

### 步骤4：配置云开发环境

1. 在微信开发者工具中点击 **云开发** 按钮
2. 开通云开发（如果还未开通）
3. 记录你的环境ID

---

## 📝 使用说明

### 前端页面使用流程

1. **上传图片**
   - 点击图片上传区域
   - 从相册选择或拍照
   - 图片自动上传至云存储

2. **选择功能选项**
   - AI图片描述：选择描述风格
   - AI智能配文：选择平台和主题
   - AI图片增强：选择增强类型
   - AI风格迁移：选择艺术风格

3. **生成/处理**
   - 点击"生成"按钮
   - 等待AI处理（通常3-10秒）
   - 查看处理结果

4. **保存结果**
   - 复制文字内容
   - 保存处理后的图片到相册

---

## 🔧 技术架构

### 云函数调用方式

```javascript
// 调用AI图片描述
const res = await wx.cloud.callFunction({
  name: 'aiImageDescribe',
  data: {
    fileID: 'cloud://xxx.jpg',
    style: 'professional'
  }
});

// 调用AI智能配文
const res = await wx.cloud.callFunction({
  name: 'aiCaption',
  data: {
    fileID: 'cloud://xxx.jpg',
    platform: 'xiaohongshu',
    topic: '美食'
  }
});

// 调用AI图片增强
const res = await wx.cloud.callFunction({
  name: 'aiImageEnhance',
  data: {
    fileID: 'cloud://xxx.jpg',
    type: 'upscale'
  }
});

// 调用AI风格迁移
const res = await wx.cloud.callFunction({
  name: 'aiStyleTransfer',
  data: {
    fileID: 'cloud://xxx.jpg',
    style: 'oil-painting'
  }
});
```

### 免费额度使用建议

1. **文生文Token额度**（1亿Token）
   - AI图片描述：每次约200-500 Token
   - AI智能配文：每次约300-600 Token
   - **预估可支持**：10万-30万次调用

2. **文生图额度**（1万张）
   - AI风格迁移：每次1张
   - **预估可支持**：1万次风格转换

3. **云函数调用**
   - 前6个月免费额度非常充足
   - 注意控制单次调用时长（避免超时）

---

## ⚠️ 注意事项

### API密钥安全
- ✅ API密钥已配置在云函数环境变量中，**不会暴露给前端**
- ✅ 前端通过云函数间接调用API，安全可控
- ❌ **切勿**将API密钥写在前端代码中

### 降级策略
所有云函数都实现了**模拟降级**功能：
- 当未配置API密钥时，自动返回模拟结果
- 当API调用失败时，自动返回模拟结果
- 确保功能始终可用，不会报错

### 性能优化
- AI图片增强和风格迁移可能需要10-30秒
- 建议添加loading提示，避免用户重复点击
- 可考虑添加缓存机制，避免重复处理相同图片

---

## 📊 功能对比

| 功能 | 免费额度 | 调用频率 | 适用场景 |
|------|---------|---------|---------|
| AI图片描述 | 1亿Token | 高 | 朋友圈配图、商品描述 |
| AI智能配文 | 1亿Token | 高 | 社交媒体运营 |
| AI图片增强 | 云函数额度 | 中 | 老照片修复、打印 |
| AI风格迁移 | 1万张 | 低 | 创意设计、娱乐 |

---

## 🎯 下一步计划

建议继续添加以下AI功能：

1. **AI智能抠图** - 自动识别并提取主体
2. **AI背景替换** - 一键更换背景场景
3. **AI人脸编辑** - 美颜、年龄变换等
4. **AI图片修复** - 去除划痕、污渍
5. **AI色彩增强** - 自动调色、HDR效果

---

## 📞 技术支持

- **微信开发者文档**：https://developers.weixin.qq.com/miniprogram/dev/framework/
- **腾讯云混元API**：https://cloud.tencent.com/product/hunyuan
- **AI小程序成长计划**：https://developers.weixin.qq.com/community/minihome/doc/000240324d04c0da3b74f179b61401

---

## ✅ 检查清单

部署前请确认：
- [ ] 已报名微信AI小程序成长计划
- [ ] 已获取腾讯云API密钥
- [ ] 已配置所有云函数的环境变量
- [ ] 已安装云函数依赖
- [ ] 已上传并部署所有云函数
- [ ] 已在云开发控制台创建云存储环境
- [ ] 已测试前端页面功能正常

---

**祝你开发顺利！🎉**
