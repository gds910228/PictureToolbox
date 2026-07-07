// cloudfunctions/aiCaption/index.js
// AI智能配文云函数 - 看图按平台生成可发布的社媒配文（混元 VLM）
//
// 定位：aiCaption = 帮这张图配句话发出去（可发布文案，按平台口吻 + 话题标签）
// 区别于 aiImageDescribe = 看懂这张图（客观描述/解读，不面向发布）。
//
// 安全/诚实性约定：
// 1. 密钥未配置 → 返回 mock 示例文案（附 mock:true，仅供本地开发），前端会标注「示例」；
//    密钥已配置但调用/解析失败 → 返回 success:false（不再静默 mock，避免假文案冒充 AI）。
// 2. 限流：复用统一模块 rate-limiter，featureKey='caption'，每功能独立计数。
//    rate_limit 集合需在云开发控制台手动创建；不存在时降级放行并 console.error 提示。
//    限额走环境变量 RATE_LIMIT_DAILY（缺省 20），控制台可改免重新部署。
// 3. 服务端内容安全兜底：下载原图过 assertImageSafe，违规即拒（不暴露原因）。

const cloud = require('wx-server-sdk');
const tencentcloud = require('tencentcloud-sdk-nodejs');
const secret = require('./cloud-secret');
const contentCheck = require('./content-check');
const rateLimiter = require('./rate-limiter');

// 导入混元产品模块
const HunyuanClient = tencentcloud.hunyuan.v20230901.Client;

const FEATURE_KEY = 'caption';

// 初始化云开发环境
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

/**
 * 生成智能配文
 * @param {Object} event - { fileID, base64Image, platform, topic }
 * @returns {Object} - { success, captions, platform, mock?, used?, limit? | error }
 */
exports.main = async (event, context) => {
  const { fileID, base64Image, platform = 'moments', topic = '' } = event;

  try {
    // 取调用者 openid（用于限流；云函数端可稳定获取）
    const wxCtx = cloud.getWXContext();
    const openid = wxCtx && wxCtx.OPENID;

    // 图片入参处理：fileID 优先（服务端安全兜底），其次 base64
    let imageURL = '';
    if (fileID) {
      // 服务端内容安全兜底：下载原图过检，违规即拒（不暴露原因）
      const _secDl = await cloud.downloadFile({ fileID });
      await contentCheck.assertImageSafe(_secDl.fileContent, cloud);

      const result = await cloud.getTempFileURL({ fileList: [fileID] });
      imageURL = result.fileList[0].tempFileURL;
    } else if (base64Image) {
      imageURL = base64Image;
    } else {
      return { success: false, error: '缺少图片参数' };
    }

    // 密钥未配置 → mock 示例文案（开发兜底，前端标注「示例」）
    const cred = secret.getCredentials();
    if (!cred.available) {
      return {
        success: true,
        captions: mockCaptions(platform, topic),
        platform,
        mock: true
      };
    }

    // 密钥可用 → 限流检查（调用前计数）
    const rl = await rateLimiter.checkRateLimit(openid, FEATURE_KEY, cloud);
    if (!rl.ok) {
      return {
        success: false,
        error: 'rate_limit',
        limit: rl.limit,
        used: rl.used,
        resetAt: '次日0点'
      };
    }

    // 真实调用混元（失败抛错，由 catch 返回失败，不再静默 mock）
    const captions = await callHunyuanAPI(imageURL, platform, topic, cred);

    return {
      success: true,
      captions,
      platform,
      mock: false,
      used: rl.used,
      limit: rl.limit
    };
  } catch (err) {
    console.error('智能配文生成失败', err);
    return { success: false, error: err.message || 'AI 服务暂时不可用，请稍后重试' };
  }
};

/**
 * 调用混元 VLM 生成配文。失败抛错（不 mock）。
 */
async function callHunyuanAPI(imageURL, platform, topic, cred) {
  const client = new HunyuanClient({
    credential: { secretId: cred.secretId, secretKey: cred.secretKey },
    region: cred.region,
    profile: { signMethod: 'TC3-HMAC-SHA256' }
  });

  const prompt = buildPrompt(platform, topic);

  // 多模态消息：Contents 数组（image_url + text）。单轮调用，不混用历史。
  const params = {
    Model: 'hunyuan-vision',
    Messages: [
      {
        Role: 'user',
        Contents: [
          { Type: 'image_url', ImageUrl: { Url: imageURL } },
          { Type: 'text', Text: prompt }
        ]
      }
    ],
    Stream: false
  };

  const response = await client.ChatCompletions(params);
  const result = response.Response || response;
  if (!result.Choices || !result.Choices.length || !result.Choices[0].Message) {
    throw new Error('AI 返回为空');
  }
  const content = result.Choices[0].Message.Content;

  const captions = parseCaptions(content);
  if (!captions || !captions.length) {
    throw new Error('AI 返回格式无法解析');
  }
  return captions;
}

/**
 * 按平台 + 主题构建 system/user prompt。
 * 验收点对齐：朋友圈 ≤80字无标签；小红书 标题党+5-8 话题；微博 ≤140字+2-3 话题；抖音 口播+引导互动。
 * 强约束「只返回纯 JSON 字符串数组」以提升解析稳定性。
 */
function buildPrompt(platform, topic) {
  const platformPrompts = {
    moments: `请为这张图片生成3条适合发微信朋友圈的文案。要求：
1. 口语化、自然，像随手发的，不要书面腔
2. 有情绪钩子（一句让人想点赞或共鸣的话）
3. 每条 ≤80 字（含标点和 emoji）
4. 可适当用 emoji，但不要堆砌
5. 不要话题标签
6. 3 条风格各异：如文艺、搞笑、温暖

只返回纯 JSON 字符串数组，不要任何前后说明文字，不要 markdown 代码块。格式示例：["文案1","文案2","文案3"]`,

    xiaohongshu: `请为这张图片生成3条适合发小红书的笔记文案。要求：
1. 第一句必须是标题党，足够吸睛
2. 正文列 2-3 个要点，营造种草氛围
3. 结尾必须带 5-8 个 #话题# 标签
4. 每条 50-100 字（含标签）
5. 多用 emoji
6. 3 条切入角度不同

只返回纯 JSON 字符串数组，每条文案内部用 \\n 换行分段，不要任何前后说明文字，不要 markdown 代码块。格式示例：["标题\\n正文\\n#话题1 #话题2","标题\\n正文\\n#话题3","标题\\n正文\\n#话题4"]`,

    weibo: `请为这张图片生成3条适合发微博的文案。要求：
1. 轻松幽默，可用网络流行语
2. 每条 ≤140 字（含标点与话题）
3. 带 2-3 个 #话题#
4. 容易引发转发和评论
5. 3 条风格各异

只返回纯 JSON 字符串数组，不要任何前后说明文字，不要 markdown 代码块。格式示例：["文案 #话题1# #话题2#","文案 #话题3#","文案"]`,

    douyin: `请为这张图片生成3条适合发抖音的短视频文案。要求：
1. 口播口吻，短小有冲击力，有节奏感
2. 每条 20-60 字
3. 结尾必须有引导互动（提问、求评论、求双击、引导主页等）
4. 情绪张力强，容易记住和传播
5. 3 条风格各异

只返回纯 JSON 字符串数组，不要任何前后说明文字，不要 markdown 代码块。格式示例：["文案 引导语","文案 引导语","文案 引导语"]`
  };

  let prompt = platformPrompts[platform] || platformPrompts.moments;

  // 指定主题时，在 prompt 开头强调主题约束
  if (topic && topic.trim()) {
    prompt = `【重要主题要求】本次所有文案必须围绕"${topic}"展开，紧扣该主题体现其特点。\n\n` + prompt;
  }
  return prompt;
}

/**
 * 三级降级解析模型返回为字符串数组：
 *  1. 整段 JSON.parse
 *  2. 剥离 ```json ... ``` 代码块包裹后重试
 *  3. 正则提取首个 [...] 再 parse
 * 解析失败返回 null（由调用方抛错）。
 */
function parseCaptions(content) {
  if (!content) return null;
  const text = String(content).trim();

  // 1. 整段直解
  try {
    const a = JSON.parse(text);
    if (Array.isArray(a)) return a.filter(x => typeof x === 'string');
  } catch (e) {}

  // 2. 剥离 markdown 代码块包裹
  const fenced = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/,'')
    .trim();
  if (fenced !== text) {
    try {
      const a = JSON.parse(fenced);
      if (Array.isArray(a)) return a.filter(x => typeof x === 'string');
    } catch (e) {}
  }

  // 3. 正则提取首个 [...]（处理模型加了前导语的情况）
  const m = text.match(/\[[\s\S]*\]/);
  if (m) {
    try {
      const a = JSON.parse(m[0]);
      if (Array.isArray(a)) return a.filter(x => typeof x === 'string');
    } catch (e) {}
  }
  return null;
}

/**
 * 模拟配文（仅密钥未配置的开发环境使用，前端会标注「示例」）。
 * 各平台风格与 prompt 要求保持一致（小红书补足 5-8 话题）。
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
      `${topicText}谁懂啊！这个真的绝了！💯\n一眼心动，细节满分，强烈安利给大家～\n#生活美学 #每日分享 #宝藏 #好物推荐 #种草日记 #生活记录`,
      `${topicText}姐妹们快看！这就是我想要的～ 🌟\n氛围感拉满，性价比超高，闭眼入不踩雷！\n#种草 #好物推荐 #生活日记 #氛围感 #分享 #日常`,
      `${topicText}不允许还有人不知道这个！🔥\n真香警告，看了就想拥有，错过等一年！\n#必入 #真实测评 #生活好物 #推荐 #热门 #好物`
    ],
    weibo: [
      `${topicText}今天也是被治愈的一天 🌈 #日常 #生活`,
      `${topicText}这谁顶得住啊！😎 #分享 #快乐源泉`,
      `${topicText}我不允许我的相册里没有这个！💫 #好看 #推荐`
    ],
    douyin: [
      `${topicText}这质感，爱了爱了！😍 评论区告诉我你打几分？`,
      `${topicText}被问爆了！链接在主页 👇 双击收藏不迷路～`,
      `${topicText}谁拍谁好看！教程来啦 📸 你最想学哪一步？`
    ]
  };

  return captions[platform] || captions.moments;
}
