// cloudfunctions/aiImageChat/index.js
// AI图片问答云函数 - 混元多模态大模型(hunyuan-vision)，支持多轮对话
//
// 设计：仅首轮带图（省 token / 省流量 / 更快）。
//   - 首轮(history 为空)：user 消息含 image_url + 问题，模型"看见"图。
//   - 后续轮(history 非空)：只发纯文本历史 + 当前问题，不再重传图。
//     模型靠前文 assistant 回答里的视觉信息延续上下文；短追问通常 OK，
//     长程多轮可能丢视觉细节——这是有意的成本取舍。
//
// 安全：首轮图片走服务端 assertImageSafe 兜底；问题文本由前端 guardText
// (调 checkImage 云函数 msgSecCheck) 已拦截，本函数不再重复文本检测。
//
// 降级：密钥未配置 → 返回演示文本(标注 demo)；API 调用失败 → success:false，
//       绝不伪造真实回答。

const cloud = require('wx-server-sdk');
const tencentcloud = require('tencentcloud-sdk-nodejs');
const secret = require('./cloud-secret');
const contentCheck = require('./content-check');

const HunyuanClient = tencentcloud.hunyuan.v20230901.Client;

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

// 携带历史消息上限（user+assistant 合计），超出截断旧端，控制 token
const MAX_HISTORY = 20;
const MAX_Q_LEN = 500;
const MAX_MSG_LEN = 2000;

/**
 * AI 图片问答
 * @param {Object} event
 * @param {string} [event.fileID] - 首轮必填，云存储 fileID
 * @param {string} event.question - 当前问题
 * @param {Array<{role:string, content:string}>} [event.history] - 历史轮次(纯文本)
 * @returns {{success:boolean, answer?:string, demo?:boolean, error?:string}}
 */
exports.main = async (event, context) => {
  const { fileID, question, history = [] } = event;

  if (!question || !String(question).trim()) {
    return { success: false, error: '请输入问题' };
  }
  const q = String(question).trim().slice(0, MAX_Q_LEN);

  try {
    const messages = [];

    // 1) 历史轮次 → 纯文本消息（仅首轮曾带图，这里不再带）
    //    注意：纯文本消息用 Content(单数字符串)，不是 Contents 数组。
    //    Contents 数组仅用于含图的多模态消息（见下方首轮）。—— 腾讯混元官方示例7/5
    const hist = Array.isArray(history) ? history.slice(-MAX_HISTORY) : [];
    for (const h of hist) {
      if (!h || !h.role || !h.content) continue;
      messages.push({
        Role: h.role === 'assistant' ? 'assistant' : 'user',
        Content: String(h.content).slice(0, MAX_MSG_LEN)
      });
    }

    // 2) 当前问题
    if (messages.length === 0) {
      // 首轮：必须有图
      if (!fileID) {
        return { success: false, error: '请先上传图片' };
      }
      // 服务端图片内容安全兜底：违规即拒（不暴露原因，由前端 catch 显示标准化提示）
      const dl = await cloud.downloadFile({ fileID });
      await contentCheck.assertImageSafe(dl.fileContent, cloud);

      const urlRes = await cloud.getTempFileURL({ fileList: [fileID] });
      const imageURL = urlRes.fileList[0] && urlRes.fileList[0].tempFileURL;
      if (!imageURL) {
        return { success: false, error: '图片地址获取失败，请重试' };
      }

      messages.push({
        Role: 'user',
        Contents: [
          { Type: 'image_url', ImageUrl: { Url: imageURL } },
          { Type: 'text', Text: q }
        ]
      });
    } else {
      // 后续轮：纯文本追问，不重传图（Content 字符串，非 Contents 数组）
      messages.push({
        Role: 'user',
        Content: q
      });
    }

    // 3) 调混元
    const r = await callHunyuan(messages);
    if (r.ok) {
      return { success: true, answer: r.text, demo: !!r.demo };
    }
    return { success: false, error: r.error || 'AI 暂时不可用，请稍后重试' };
  } catch (err) {
    console.error('图片问答失败', err);
    const msg = /违规/.test(err.message)
      ? err.message
      : 'AI 暂时开小差了，请稍后重试';
    return { success: false, error: msg };
  }
};

/**
 * 调用混元 ChatCompletions
 * @returns {Promise<{ok:boolean, text?:string, demo?:boolean, error?:string}>}
 */
async function callHunyuan(messages) {
  const cred = secret.getCredentials();
  if (!cred.available) {
    // 未配置密钥：演示模式（明确标注，不伪装成真实回答）
    return { ok: true, demo: true, text: mockAnswer() };
  }

  try {
    const client = new HunyuanClient({
      credential: { secretId: cred.secretId, secretKey: cred.secretKey },
      region: cred.region,
      profile: { signMethod: 'TC3-HMAC-SHA256' }
    });

    const params = {
      Model: 'hunyuan-vision',
      Messages: messages,
      Stream: false
    };

    const response = await client.ChatCompletions(params);
    const result = response.Response || response;
    if (result.Choices && result.Choices.length > 0 && result.Choices[0].Message) {
      const content = result.Choices[0].Message.Content;
      if (content && String(content).trim()) {
        return { ok: true, text: String(content).trim() };
      }
    }
    return { ok: false, error: 'AI 未返回有效内容，请重试' };
  } catch (err) {
    console.error('调用混元API失败:', err);
    return { ok: false, error: 'AI 服务暂时不可用，请稍后重试' };
  }
}

function mockAnswer() {
  return '（演示模式）我已收到你的提问。配置腾讯云混元 API 密钥后即可获得真实的图片问答能力——在微信云开发控制台为本云函数设置环境变量 TENCENTCLOUD_SECRET_ID / TENCENTCLOUD_SECRET_KEY 即可。';
}
