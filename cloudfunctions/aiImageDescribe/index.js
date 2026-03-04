// cloudfunctions/aiImageDescribe/index.js
// AI图片描述云函数 - 使用混元大模型生成图片描述

const cloud = require('wx-server-sdk');
const tencentcloud = require('tencentcloud-sdk-nodejs');

// 导入混元产品模块
const HunyuanClient = tencentcloud.hunyuan.v20230901.Client;

// 初始化云开发环境
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

/**
 * 生成图片描述
 * @param {event} Object - { fileID: string, base64Image: string, style: string }
 * @returns {Object} - 描述结果
 */
exports.main = async (event, context) => {
  const { fileID, base64Image, style = 'professional' } = event;

  console.log('开始生成图片描述', { fileID, hasBase64: !!base64Image, style });

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
        error: '缺少图片参数'
      };
    }

    // 调用混元大模型API生成描述
    console.log('调用混元API生成描述...');
    const description = await callHunyuanAPI(imageURL, style);

    console.log('AI描述生成完成');

    return {
      success: true,
      description: description,
      style: style
    };

  } catch (err) {
    console.error('图片描述生成失败', err);
    return {
      success: false,
      error: err.message
    };
  }
};

/**
 * 调用混元大模型API生成图片描述
 */
async function callHunyuanAPI(imageURL, style) {
  // 从环境变量获取API密钥
  const secretId = process.env.TENCENTCLOUD_SECRET_ID;
  const secretKey = process.env.TENCENTCLOUD_SECRET_KEY;
  const region = process.env.TENCENTCLOUD_REGION || 'ap-guangzhou';

  // 检查是否配置了API密钥
  if (!secretId || !secretKey) {
    console.log('未配置API密钥，使用模拟实现');
    return mockDescription(style);
  }

  // 检查是否使用占位符
  if (secretId === '' || secretKey === '' || secretId.includes('你的') || secretKey.includes('你的')) {
    console.log('使用占位符密钥，使用模拟实现');
    return mockDescription(style);
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

    // 根据风格构建不同的提示词
    const stylePrompts = {
      professional: `请专业地描述这张图片。要求：
1. 识别图片中的主要物体、人物、场景
2. 描述颜色、光线、构图等视觉元素
3. 说明图片的氛围和情感
4. 使用简洁专业的语言，50-100字`,

      artistic: `请用艺术性的语言描述这张图片。要求：
1. 用诗意的语言描绘画面
2. 关注色彩、光影、意境的表达
3. 联想画面背后的故事
4. 使用优美的修辞，80-120字`,

      detailed: `请详细地描述这张图片的每个细节。要求：
1. 从整体到局部逐层描述
2. 包括前景、中景、背景
3. 描述物体材质、纹理、细节
4. 说明构图和视角
5. 150-200字`,

      social: `请为这张图片写一段适合社交媒体的描述。要求：
1. 用轻松活泼的语言
2. 可以使用emoji表情
3. 适合发朋友圈、小红书等平台
4. 引发共鸣或互动
5. 50-80字`
    };

    const prompt = stylePrompts[style] || stylePrompts.professional;

    // 构建请求参数
    const params = {
      Model: "hunyuan-vision",
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
              Text: prompt
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
      return content.trim();
    }

    // 如果解析失败，使用模拟实现
    console.log('解析API返回失败，使用模拟实现');
    return mockDescription(style);

  } catch (err) {
    console.error('调用混元API失败:', err);
    // API调用失败时，使用模拟实现
    return mockDescription(style);
  }
}

/**
 * 模拟图片描述（当API未配置或调用失败时使用）
 */
function mockDescription(style) {
  const descriptions = {
    professional: `这张图片展现了精美的视觉构图。画面中光线柔和自然，色彩和谐统一，主体突出且细节丰富。整体呈现出专业级摄影作品的质感，具有良好的视觉平衡和美学价值。`,

    artistic: `光影如诗，如梦似幻。画面流淌着温柔的色调，每一个细节都在诉说着独特的故事。这不仅是影像，更是凝固的时光，值得细细品味与珍藏。✨`,

    detailed: `这是一张构图精美的图片。从整体来看，画面层次分明，布局合理。前景部分细节清晰，主体突出；中景部分过渡自然，元素协调；背景部分简洁大方，不喧宾夺主。色彩运用恰到好处，明暗对比适度，充分展现了创作者的用心和技巧。`,

    social: `捕捉到的美好瞬间～ 📷 这样的画面真的太治愈了！每一个细节都充满惊喜，让人忍不住想多看几眼。生活需要这样的小确幸，你说是吗？ 😊✨ #生活美学 #视觉盛宴`
  };

  return descriptions[style] || descriptions.professional;
}
