// cloudfunctions/aiImageDescribe/index.js
// AI图片描述云函数 - 使用 TokenHub 视觉模型(hy-vision-2.0-instruct)生成图片描述
//
// 定位：生成客观描述/解读（看懂图）。社媒发布文案请用 aiCaption 云函数；
// 本函数 social 风格已移除以避免与 aiCaption 配文重叠。
//
// 安全/诚实性约定（对齐 aiCaption）：
// 1. TokenHub API Key 未配置 → 返回 mock 示例描述（附 isMock:true，仅供本地开发），前端标注「示例文案」；
//    已配置但调用/解析失败 → 返回 success:false（不再静默 mock，避免假描述冒充 AI）。
// 2. 限流：复用统一模块 rate-limiter，featureKey='describe'，每功能独立计数。
//    限额走环境变量 RATE_LIMIT_DAILY（缺省 20），控制台可改免重新部署。
// 3. 服务端内容安全兜底：下载原图过 assertImageSafe，违规即拒（不暴露原因）。
// 4. 模型：原 hunyuan-vision 已下线（2026-10），迁移 TokenHub 平台，见 tokenhub.js 头注。

const cloud = require('wx-server-sdk');
const tokenhub = require('./tokenhub');
const contentCheck = require('./content-check');
const rateLimiter = require('./rate-limiter');

// 初始化云开发环境
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const FEATURE_KEY = 'describe';

/**
 * 生成图片描述
 * @param {event} Object - { fileID: string, base64Image: string, style: string, action?: 'quota' }
 * @returns {Object} - { success, description, style, isMock, used?, limit? | error }
 */
exports.main = async (event, context) => {
  const action = event.action || 'describe';

  // 轻量查询分支：只读当日描述额度，不计数、不消耗（前端进页面展示额度条用）
  if (action === 'quota') {
    const wxCtxQ = cloud.getWXContext();
    const openidQ = wxCtxQ && wxCtxQ.OPENID;
    if (!tokenhub.isConfigured()) {
      return { success: true, demo: true, used: 0, limit: rateLimiter.resolveLimit() };
    }
    return await rateLimiter.queryQuota(openidQ, FEATURE_KEY, cloud);
  }

  const { fileID, base64Image, style = 'professional' } = event;


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
        error: '缺少图片参数'
      };
    }

    // TokenHub API Key 可用 → 限流（mock 态不消耗额度，不计数）
    let rl = null;
    if (tokenhub.isConfigured()) {
      const wxCtx = cloud.getWXContext();
      const openid = wxCtx && wxCtx.OPENID;
      rl = await rateLimiter.checkRateLimit(openid, FEATURE_KEY, cloud);
      if (!rl.ok) {
        return {
          success: false,
          error: 'rate_limit',
          limit: rl.limit,
          used: rl.used,
          resetAt: '次日0点'
        };
      }
    }

    // 调用视觉模型生成描述（失败抛错，由 catch 返回失败，不再静默 mock）
    const { description, isMock } = await callVisionAPI(imageURL, style);


    return {
      success: true,
      description: description,
      style: style,
      isMock: isMock,
      used: rl ? rl.used : 0,
      limit: rl ? rl.limit : rateLimiter.resolveLimit()
    };

  } catch (err) {
    console.error('图片描述生成失败', err);
    return {
      success: false,
      error: err.message || 'AI 服务暂时不可用，请稍后重试'
    };
  }
};

/**
 * 调用视觉模型生成图片描述（TokenHub，OpenAI 兼容）。
 * TokenHub API Key 未配置 → mock 描述 + isMock:true；已配置但调用/解析失败 → 抛错（不 mock）。
 * @returns {{description:string, isMock:boolean}}
 */
async function callVisionAPI(imageURL, style) {
  if (!tokenhub.isConfigured()) {
    return { description: mockDescription(style), isMock: true };
  }

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

    concise: `请用一句话简洁概括这张图片的内容。要求：
1. 抓住最核心的元素和主题
2. 10-20字之间
3. 简洁明了，一语中的
4. 突出重点信息`,

    ecommerce: `请为这张图片写一段电商产品描述。要求：
1. 突出产品的核心卖点和特色
2. 强调产品的使用场景和优势
3. 使用吸引消费者的语言
4. 可以适当使用emoji
5. 60-100字，具有购买吸引力`,

    photography: `请从摄影专业角度分析这张图片。要求：
1. 分析构图技巧（三分法、黄金分割等）
2. 评价光线运用（自然光、人造光、方向）
3. 评估色彩搭配和色调处理
4. 点评景深、对焦、曝光等技术
5. 给出专业建议，80-120字`,

    emotional: `请用情感化的语言描述这张图片的故事。要求：
1. 想象图片背后的故事和情感
2. 用温暖、感人的语言描述
3. 关注人物表情、动作传递的情感
4. 营造共鸣和代入感
5. 80-120字，像讲一个故事`
  };

  const prompt = stylePrompts[style] || stylePrompts.professional;

  // 多模态消息：OpenAI 兼容 content 数组（image_url + text）
  const messages = [
    {
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: tokenhub.normalizeImageUrl(imageURL) } },
        { type: 'text', text: prompt }
      ]
    }
  ];

  // 调用API（失败抛错，由主流程 catch 返回 success:false，不再静默 mock）
  const content = await tokenhub.chatCompletion({ messages });
  if (!content) {
    throw new Error('AI 返回格式无法解析');
  }
  return { description: content.trim(), isMock: false };
}

/**
 * 模拟图片描述（仅密钥未配置的开发环境使用，前端标注「示例文案」）。
 */
function mockDescription(style) {
  const descriptions = {
    professional: `这张图片展现了精美的视觉构图。画面中光线柔和自然，色彩和谐统一，主体突出且细节丰富。整体呈现出专业级摄影作品的质感，具有良好的视觉平衡和美学价值。`,

    artistic: `光影如诗，如梦似幻。画面流淌着温柔的色调，每一个细节都在诉说着独特的故事。这不仅是影像，更是凝固的时光，值得细细品味与珍藏。✨`,

    detailed: `这是一张构图精美的图片。从整体来看，画面层次分明，布局合理。前景部分细节清晰，主体突出；中景部分过渡自然，元素协调；背景部分简洁大方，不喧宾夺主。色彩运用恰到好处，明暗对比适度，充分展现了创作者的用心和技巧。`,

    concise: `精美的画面构图，光线柔和，色彩和谐。`,

    ecommerce: `【品质优选】精心设计的产品，展现独特魅力。细节精致，质感出众，是您生活的不二之选！🛒✨ 限时特惠，不容错过！`,

    photography: `这张照片运用了优秀的构图技巧，采用了经典的三分法则。光线处理得当，自然光与阴影形成良好的对比。色彩搭配和谐，白平衡准确，景深控制合理。是一张技术过硬的作品。建议可以尝试更多角度拍摄。`,

    emotional: `这不仅仅是一张图片，更是一段温暖的记忆。画面中流露的情感如此真实，仿佛能感受到那一刻的温柔。时间在这里静止，留下的是永恒的感动和美好。愿这份温暖也能触动你的心。💫`
  };

  return descriptions[style] || descriptions.professional;
}
