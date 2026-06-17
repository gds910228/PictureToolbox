# AI文字识别 (OCR) 功能配置说明

## 功能概述

AI文字识别功能基于**腾讯云通用印刷体OCR（高精度版）**，支持：
- 中英文数字混合识别
- 返回每段文字的坐标、置信度
- 每月免费额度 1000 次
- 未配置密钥时自动降级为示例数据，不崩溃

---

## 快速配置步骤

### 1. 获取腾讯云 API 密钥

1. 登录 [腾讯云控制台](https://console.cloud.tencent.com/)
2. 进入 [访问管理 →  API密钥管理](https://console.cloud.tencent.com/cam/capi)
3. 创建或获取 `SecretId` 和 `SecretKey`

> ⚠️ 安全提示：密钥请妥善保管，不要提交到代码仓库。建议使用**子账号密钥**并限制 OCR 相关权限。

### 2. 开通 OCR 服务

1. 进入 [腾讯云OCR产品页](https://cloud.tencent.com/product/ocr)
2. 点击「立即使用」开通服务
3. 选择「通用印刷体识别（高精度版）」
4. 每月前 1000 次免费，超出按量计费

### 3. 配置云函数环境变量

在微信开发者工具中：

**方式一：通过 config.json 配置（推荐）**

编辑 `cloudfunctions/aiOCR/config.json`：

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

**方式二：在云开发控制台配置**

1. 打开微信开发者工具 → 云开发
2. 进入「云函数」→ 找到 `aiOCR`
3. 点击「配置」→「环境变量」
4. 添加以下三个变量：

| 变量名 | 说明 | 示例 |
|--------|------|------|
| `TENCENTCLOUD_SECRET_ID` | 腾讯云 SecretId | `AKIDxxxxxxxxxxxx` |
| `TENCENTCLOUD_SECRET_KEY` | 腾讯云 SecretKey | `xxxxxxxxxxxxxxxxxxxx` |
| `TENCENTCLOUD_REGION` | 服务地域 | `ap-guangzhou` |

### 4. 部署云函数

1. 在微信开发者工具中，右键 `cloudfunctions/aiOCR` 文件夹
2. 选择「上传并部署：云端安装依赖」
3. 等待部署完成

### 5. 验证

1. 在小程序中进入「AI文字识别」页面
2. 选择一张含文字的图片
3. 查看识别结果，如果显示真实识别结果则配置成功
4. 如果显示「功能初始化中，当前为示例数据」，说明密钥未配置正确

---

## 支持的地域

常用地域列表：

| 地域 | 地域 ID |
|------|---------|
| 广州 | `ap-guangzhou` |
| 上海 | `ap-shanghai` |
| 北京 | `ap-beijing` |
| 成都 | `ap-chengdu` |
| 香港 | `ap-hongkong` |
| 新加坡 | `ap-singapore` |

推荐选择离你最近的地域以降低延迟。

---

## 费用说明

- **通用印刷体识别（高精度版）**：每月免费 1000 次
- 超出后：0.2 元/千次（按量付费）
- 具体价格以 [腾讯云OCR定价](https://cloud.tencent.com/product/ocr/pricing) 为准

---

## 故障排查

### Q: 一直显示「功能初始化中，展示示例数据」

**原因**：云函数未检测到有效 API 密钥，使用了模拟数据。

**排查步骤**：
1. 确认 `config.json` 中的密钥已替换为真实值（不是 `your_secret_id_here`）
2. 确认云函数已重新部署
3. 在云开发控制台查看云函数日志，检查环境变量是否正确
4. 确认密钥对应的腾讯云账号已开通 OCR 服务

### Q: 提示「识别失败」

**排查步骤**：
1. 检查云函数日志，查看具体错误信息
2. 确认密钥是否正确（不要有多余空格）
3. 确认腾讯云账号是否有余额或在免费额度内
4. 检查图片格式是否支持（JPG/PNG/GIF/BMP）
5. 图片大小不能超过 7MB

### Q: 识别结果不准确

1. 确保图片清晰、光线充足
2. 文字与背景对比度高
3. 拍摄角度尽量正对文字
4. 避免模糊、反光、倾斜过大

---

## 返回数据格式

云函数返回的 `textDetections` 数组中每一项包含：

```javascript
{
  index: 0,              // 行索引
  text: "识别的文字内容",  // 识别出的文字
  confidence: 99,        // 置信度 (0-100)
  bbox: {                // 边界框（像素坐标）
    x: 50,
    y: 40,
    width: 200,
    height: 30
  },
  bboxPct: {             // 边界框（百分比，用于前端适配）
    x: 6.25,
    y: 6.67,
    width: 25,
    height: 5
  },
  polygon: [             // 多边形四个角点
    { x: 50, y: 40 },
    { x: 250, y: 40 },
    { x: 250, y: 70 },
    { x: 50, y: 70 }
  ],
  polygonPct: [...]      // 多边形（百分比）
}
```

---

## 目录结构

```
cloudfunctions/aiOCR/
├── index.js          # 云函数主逻辑
├── package.json      # 依赖配置
├── config.json       # 环境变量配置
└── README.md         # 本文档

pages/aiOCR/
├── aiOCR.js          # 页面逻辑
├── aiOCR.wxml        # 页面结构
├── aiOCR.wxss        # 页面样式
└── aiOCR.json        # 页面配置
```

---

## 相关链接

- [腾讯云 OCR 产品文档](https://cloud.tencent.com/document/product/866)
- [通用印刷体识别（高精度版）API](https://cloud.tencent.com/document/product/866/34938)
- [微信小程序云开发文档](https://developers.weixin.qq.com/miniprogram/dev/wxcloud/basis/getting-started.html)
