// cloudfunctions/analyzeImage/index.js
// AI图片分析云函数 - 使用混元大模型分析图片内容
//
// 安全/诚实性约定（对齐 aiCaption）：
// 1. 密钥未配置 → 返回固定 mock 示例结果（附 isMock:true，仅供本地开发），前端标注「示例分析」；
//    密钥已配置但调用/解析失败 → 返回 success:false（不再静默 mock，避免假分析冒充 AI）。
// 2. 服务端内容安全兜底：下载原图过 assertImageSafe，违规即拒（不暴露原因）。
// 3. 多模态消息用规范格式 {Type:'image_url', ImageUrl:{Url}}（与 aiCaption/aiImageDescribe 一致）。

const cloud = require('wx-server-sdk');
const tencentcloud = require('tencentcloud-sdk-nodejs');
const secret = require('./cloud-secret');
const contentCheck = require('./content-check');

// 导入混元产品模块
const HunyuanClient = tencentcloud.hunyuan.v20230901.Client;

// 初始化云开发环境
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

/**
 * 分析图片内容类型和推荐压缩策略
 * @param {event} Object - { fileID: string, base64Image: string }
 * @returns {Object} - { success, isMock, imageType, confidence, recommendation | error }
 */
exports.main = async (event, context) => {
  const { fileID, base64Image } = event;


  try {
    // 如果传入的是fileID，需要先获取临时URL
    let imageURL = '';
    if (fileID) {
      // 服务端内容安全兜底：下载原图过检，违规即拒（不暴露原因）
      const _secDl = await cloud.downloadFile({ fileID });
      await contentCheck.assertImageSafe(_secDl.fileContent, cloud);

      const result = await cloud.getTempFileURL({
        fileList: [fileID]
      });
      imageURL = result.fileList[0].tempFileURL;
    } else if (base64Image) {
      // 使用base64图片
      imageURL = base64Image;
    } else {
      return {
        success: false,
        error: '缺少图片参数',
        recommendation: {
          imageType: 'unknown',
          strategy: 'balanced',
          suggestedQuality: 80,
          reason: '无法分析，使用默认压缩策略'
        }
      };
    }

    // 调用混元大模型API分析图片（失败抛错，由 catch 返回失败，不再静默 mock）
    const analysisResult = await callHunyuanAPI(imageURL);


    return {
      success: true,
      isMock: analysisResult.isMock,
      imageType: analysisResult.imageType,
      confidence: analysisResult.confidence,
      recommendation: {
        strategy: analysisResult.strategy,
        suggestedQuality: analysisResult.suggestedQuality,
        reason: analysisResult.reason,
        tips: analysisResult.tips
      }
    };

  } catch (err) {
    console.error('图片分析失败', err);
    return {
      success: false,
      error: err.message || 'AI 分析暂时不可用，请稍后重试',
      recommendation: {
        imageType: 'unknown',
        strategy: 'balanced',
        suggestedQuality: 80,
        reason: 'AI分析失败，使用默认平衡策略'
      }
    };
  }
};

/**
 * 调用混元大模型API进行图片分析。
 * 密钥未配置 → 固定 mock 示例 + isMock:true；密钥可用但调用/解析失败 → 抛错（不 mock）。
 */
async function callHunyuanAPI(imageURL) {
  // 统一通过 cloud-secret 模块读取密钥（控制台环境变量优先）
  const cred = secret.getCredentials();

  if (!cred.available) {
    return { ...mockAnalysisResult(), isMock: true };
  }

  // 实例化混元客户端
  const client = new HunyuanClient({
    credential: {
      secretId: cred.secretId,
      secretKey: cred.secretKey,
    },
    region: cred.region,
    profile: {
      signMethod: "TC3-HMAC-SHA256",
    }
  });

  // 构建请求参数（多模态消息用规范 Contents 数组格式：image_url + text）
  const params = {
    Model: "hunyuan-vision", // 视觉理解模型
    Messages: [
      {
        Role: "user",
        Contents: [
          {
            Type: "image_url",
            ImageUrl: {
              Url: imageURL
            }
          },
          {
            Type: "text",
            Text: `请分析这张图片的内容类型（从以下类型中选择：portrait人物照、landscape风景照、text文字文档、product产品照片、screenshot截图、other其他），并给出JPEG压缩质量建议（0-100之间的整数）。

请以JSON格式返回结果，包含以下字段：
{
  "imageType": "图片类型",
  "confidence": 0.0-1.0之间的置信度,
  "strategy": "压缩策略（quality-priority质量优先/balanced平衡/size-priority体积优先）",
  "suggestedQuality": 推荐的质量值（0-100）,
  "reason": "推荐理由",
  "tips": "压缩建议"
}

压缩建议参考：
- 人物照：质量85-90%，保持面部细节
- 风景照：质量70-80%，可以适当压缩
- 文字文档：质量90-95%，保证文字清晰
- 产品照片：质量75-85%，平衡细节和大小
- 截图：质量80-85%，保留文字和UI细节
- 其他：质量80%，默认平衡策略`
          }
        ]
      }
    ],
    Stream: false
  };

  // 调用API（失败抛错，由主流程 catch 返回 success:false，不再静默 mock）
  const response = await client.ChatCompletions(params);

  // 解析返回结果
  if (!response.Response || !response.Response.Choices || !response.Response.Choices.length) {
    throw new Error('AI 返回为空');
  }
  const content = response.Response.Choices[0].Message.Content;

  // 尝试从返回内容中提取JSON
  const jsonMatch = content && content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('AI 返回格式无法解析');
  }

  const result = JSON.parse(jsonMatch[0]);

  // 验证并补全字段
  return {
    imageType: result.imageType || 'unknown',
    confidence: result.confidence || 0.8,
    strategy: result.strategy || 'balanced',
    suggestedQuality: Math.max(0, Math.min(100, parseInt(result.suggestedQuality) || 80)),
    reason: result.reason || 'AI分析完成',
    tips: result.tips || '',
    isMock: false
  };
}

/**
 * 固定 mock 分析结果（仅密钥未配置的开发环境使用，前端标注「示例分析」）。
 * 不再使用 Math.random() 掷骰子——示例内容固定为中性 balanced，避免伪造"AI 看懂了图"。
 */
function mockAnalysisResult() {
  return {
    imageType: 'other',
    confidence: 0.8,
    strategy: 'balanced',
    suggestedQuality: 80,
    reason: '示例分析：未配置 AI 密钥，使用默认平衡压缩策略',
    tips: '配置腾讯云密钥后，可获得针对图片内容的智能压缩建议'
  };
}
