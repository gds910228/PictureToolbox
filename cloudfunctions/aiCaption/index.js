// cloudfunctions/aiCaption/index.js
// AI智能配文云函数 - 根据图片生成社交媒体文案

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
 * 生成智能配文
 * @param {event} Object - { fileID: string, base64Image: string, platform: string, topic: string }
 * @returns {Object} - 配文结果
 */
exports.main = async (event, context) => {
  const { fileID, base64Image, platform = 'moments', topic = '' } = event;

  console.log('开始生成智能配文', { fileID, hasBase64: !!base64Image, platform, topic });

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

    // 调用混元大模型API生成配文
    console.log('调用混元API生成配文...');
    const captions = await callHunyuanAPI(imageURL, platform, topic);

    console.log('AI配文生成完成');

    return {
      success: true,
      captions: captions,
      platform: platform
    };

  } catch (err) {
    console.error('智能配文生成失败', err);
    return {
      success: false,
      error: err.message
    };
  }
};

/**
 * 调用混元大模型API生成智能配文
 */
async function callHunyuanAPI(imageURL, platform, topic) {
  // 统一通过 cloud-secret 模块读取密钥（控制台环境变量优先）
  const cred = secret.getCredentials();

  console.log('密钥配置检查:', {
    available: cred.available,
    secretIdPrefix: cred.secretId ? cred.secretId.substring(0, 8) : 'null',
    region: cred.region
  });

  if (!cred.available) {
    console.log('未配置API密钥，使用模拟实现');
    return mockCaptions(platform, topic);
  }

  const secretId = cred.secretId;
  const secretKey = cred.secretKey;
  const region = cred.region;

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

    // 根据平台构建不同的提示词
    const platformPrompts = {
      moments: `请为这张图片生成3条适合发微信朋友圈的文案。要求：
1. 轻松自然，不要过于正式
2. 可以适当使用emoji
3. 20-50字之间
4. 能引起朋友共鸣
5. 包含不同的风格：文艺/搞笑/温暖

请以JSON数组格式返回，例如：
["文案1", "文案2", "文案3"]`,

      xiaohongshu: `请为这张图片生成3条适合发小红书的文案。要求：
1. 有吸引力，能吸引点击
2. 使用热门emoji和话题标签
3. 50-100字
4. 营造种草氛围
5. 包含hashtag

请以JSON数组格式返回，例如：
["文案1\\n#标签1 #标签2", "文案2\\n#标签3", "文案3\\n#标签4"]`,

      weibo: `请为这张图片生成3条适合发微博的文案。要求：
1. 可以更轻松幽默
2. 适当使用网络流行语
3. 30-80字
4. 容易引起转发和评论
5. 可以带话题

请以JSON数组格式返回，例如：
["文案1 #话题", "文案2 #话题", "文案3"]`,

      douyin: `请为这张图片生成3条适合发抖音/视频的文案。要求：
1. 短小精悍，有冲击力
2. 适合视频配文
3. 20-60字
4. 有节奏感和情绪张力
5. 容易记住和传播

请以JSON数组格式返回，例如：
["文案1", "文案2", "文案3"]`
    };

    let prompt = platformPrompts[platform] || platformPrompts.moments;

    // 如果指定了话题，在提示词开头明确强调主题要求
    if (topic && topic.trim()) {
      const topicInstruction = `【重要主题要求】本次文案必须围绕"${topic}"这个主题展开，所有文案都要紧扣这个主题，体现${topic}的特点。\n\n`;
      prompt = topicInstruction + prompt;
      console.log('已添加主题要求:', topic);
    }

    // 构建请求参数
    const params = {
      Model: "hunyuan-vision",
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

    // 解析返回结果（腾讯云SDK返回结构可能是 response.Response 或直接 response）
    const result = response.Response || response;
    if (result.Choices && result.Choices.length > 0 && result.Choices[0].Message) {
      const content = result.Choices[0].Message.Content;

      // 尝试从返回内容中提取JSON数组
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const captions = JSON.parse(jsonMatch[0]);
        if (Array.isArray(captions) && captions.length >= 3) {
          console.log('成功解析AI配文:', captions);
          return captions;
        }
      }
    }

    // 如果解析失败，使用模拟实现
    console.log('解析API返回失败，使用模拟实现');
    return mockCaptions(platform, topic);

  } catch (err) {
    console.error('调用混元API失败:', err);
    // API调用失败时，使用模拟实现
    return mockCaptions(platform, topic);
  }
}

/**
 * 模拟智能配文（当API未配置或调用失败时使用）
 */
function mockCaptions(platform, topic) {
  const topicText = topic ? `关于${topic}，` : '';

  const captions = {
    moments: [
      `${topicText}生活的小确幸就在这些瞬间里 ✨`,
      `${topicText}今日份的美好已送达 📦`,
      `${topicText}捕捉到的温柔时光 ☀️`
    ],

    xiaohongshu: [
      `${topicText}谁懂啊！这个真的绝了！💯\n#生活美学 #每日分享 #宝藏`,
      `${topicText}姐妹们快看！这就是我想要的～ 🌟\n#种草 #好物推荐 #生活日记`,
      `${topicText}不允许还有人不知道这个！🔥\n#必入 #真实测评 #生活好物`
    ],

    weibo: [
      `${topicText}今天也是被治愈的一天 🌈 #日常 #生活`,
      `${topicText}这谁顶得住啊！😎 #分享 #快乐源泉`,
      `${topicText}我不允许我的相册里没有这个！💫 #好看 #推荐`
    ],

    douyin: [
      `${topicText}这质感，爱了爱了！😍`,
      `${topicText}被问爆了！链接在主页 👇`,
      `${topicText}谁拍谁好看！教程来啦 📸`
    ]
  };

  return captions[platform] || captions.moments;
}
