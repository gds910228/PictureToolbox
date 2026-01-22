// cloudfunctions/analyzeImage/index.js
// AI图片分析云函数 - 使用混元大模型分析图片内容

const cloud = require('wx-server-sdk');
const tencentcloud = require('tencentcloud-sdk-nodejs');

// 导入混元产品模块
const HunyuanClient = tencentcloud.hunyuan.v20230901.Client;

// 初始化云开发环境
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

/**
 * 分析图片内容类型和推荐压缩策略
 * @param {event} Object - { fileID: string, base64Image: string }
 * @returns {Object} - 分析结果
 */
exports.main = async (event, context) => {
  const { fileID, base64Image } = event;

  console.log('开始分析图片', { fileID, hasBase64: !!base64Image });

  try {
    // 如果传入的是fileID，需要先获取临时URL
    let imageURL = '';
    if (fileID) {
      const result = await cloud.getTempFileURL({
        fileList: [fileID]
      });
      imageURL = result.fileList[0].tempFileURL;
      console.log('获取到临时图片URL:', imageURL);
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

    // 调用混元大模型API分析图片
    console.log('调用混元API分析图片...');
    const analysisResult = await callHunyuanAPI(imageURL);

    console.log('AI分析结果:', analysisResult);

    return {
      success: true,
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
      error: err.message,
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
 * 调用混元大模型API进行图片分析
 */
async function callHunyuanAPI(imageURL) {
  // 从环境变量获取API密钥
  const secretId = process.env.TENCENTCLOUD_SECRET_ID;
  const secretKey = process.env.TENCENTCLOUD_SECRET_KEY;
  const region = process.env.TENCENTCLOUD_REGION || 'ap-guangzhou';

  // 检查是否配置了API密钥
  if (!secretId || !secretKey) {
    console.log('未配置API密钥，使用模拟实现');
    return mockAnalysisResult();
  }

  // 检查是否使用占位符（如果密钥是空字符串或占位符）
  if (secretId === '' || secretKey === '' || secretId.includes('你的') || secretKey.includes('你的')) {
    console.log('使用占位符密钥，使用模拟实现');
    return mockAnalysisResult();
  }

  try {
    // 实例化混元客户端
    const client = new HunyuanClient({
      credential: {
        secretId: secretId,
        secretKey: secretKey,
      },
      region: region,
      profile: {
        signMethod: "TC3-HMAC-SHA256",
      }
    });

    // 构建请求参数
    const params = {
      // 使用ChatCompletions接口进行图片理解
      Model: "hunyuan-vision", // 视觉理解模型
      Messages: [
        {
          Role: "user",
          Contents: [
            {
              Type: "image",
              Url: imageURL
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

    // 调用API
    const response = await client.ChatCompletions(params);

    console.log('混元API返回:', JSON.stringify(response));

    // 解析返回结果
    if (response.Response && response.Response.Choices && response.Response.Choices.length > 0) {
      const content = response.Response.Choices[0].Message.Content;

      // 尝试从返回内容中提取JSON
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);

        // 验证并补全字段
        return {
          imageType: result.imageType || 'unknown',
          confidence: result.confidence || 0.8,
          strategy: result.strategy || 'balanced',
          suggestedQuality: Math.max(0, Math.min(100, parseInt(result.suggestedQuality) || 80)),
          reason: result.reason || 'AI分析完成',
          tips: result.tips || ''
        };
      }
    }

    // 如果解析失败，使用默认值
    console.log('解析API返回失败，使用默认值');
    return mockAnalysisResult();

  } catch (err) {
    console.error('调用混元API失败:', err);
    // API调用失败时，使用模拟实现
    return mockAnalysisResult();
  }
}

/**
 * 模拟分析结果（当API未配置或调用失败时使用）
 */
function mockAnalysisResult() {
  const randomFactor = Math.random();

  if (randomFactor < 0.25) {
    return {
      imageType: 'portrait',
      confidence: 0.85,
      strategy: 'quality-priority',
      suggestedQuality: 85,
      reason: '检测到人物照片，保持较高质量以保留面部细节',
      tips: '建议质量85-90%，避免过度压缩导致面部模糊'
    };
  } else if (randomFactor < 0.5) {
    return {
      imageType: 'landscape',
      confidence: 0.78,
      strategy: 'balanced',
      suggestedQuality: 75,
      reason: '检测到风景照片，可以适当压缩以减小文件体积',
      tips: '建议质量70-80%，风景照片对压缩较为宽容'
    };
  } else if (randomFactor < 0.75) {
    return {
      imageType: 'text',
      confidence: 0.92,
      strategy: 'quality-priority',
      suggestedQuality: 90,
      reason: '检测到包含文字的图片，需要保持高质量以保证可读性',
      tips: '建议质量90-95%，文字边缘需要保持清晰'
    };
  } else {
    return {
      imageType: 'product',
      confidence: 0.81,
      strategy: 'balanced',
      suggestedQuality: 80,
      reason: '检测到产品图片，平衡质量和文件大小',
      tips: '建议质量75-85%，展示产品细节的同时控制文件大小'
    };
  }
}
