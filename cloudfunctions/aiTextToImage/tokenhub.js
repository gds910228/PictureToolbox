// tokenhub.js — 腾讯云 TokenHub 平台调用助手（OpenAI Chat Completions 兼容，非流式）
//
// canonical 源：cloudfunctionTemplate/tokenhub.js
// 每个需要视觉/语言模型的云函数各持一份相同副本（微信云函数为隔离部署单元，无法跨目录 require）。
//
// 背景（2026-10 迁移）：腾讯云混元旧模型（hunyuan-vision 等）已全量下线，
//   官方迁移至「大模型服务平台 TokenHub」，OpenAI Chat Completions 兼容协议：
//   POST https://tokenhub.tencentmaas.com/v1/chat/completions，Bearer 鉴权。
//   视觉理解替代模型：hy-vision-2.0-instruct（图片→文本，image_url 支持
//   公网 URL 与 data:image/...;base64 data URL）。
//   迁移指南：https://cloud.tencent.com/document/product/1729/131925
//
// 配置：云开发控制台 → 云函数 → 环境变量 TOKENHUB_API_KEY
//   （TokenHub 控制台 → API Key 管理页创建）。占位符检测与 cloud-secret 同规则，
//   占位值一律视为"未配置"，绝不让占位 Key 进入请求头。
//
// 降级约定：未配置 → 调用方走各自的 mock/demo 分支（isConfigured() 判断）；
//   已配置但调用失败 → 抛错，由调用方返回 success:false，绝不静默 mock。

const https = require('https');

const BASE_URL = 'https://tokenhub.tencentmaas.com';
// 视觉理解默认模型（混元视觉 2.0，图生文场景；下线潮后官方图片理解文档示例同款）
const DEFAULT_MODEL = 'hy-vision-2.0-instruct';
const DEFAULT_TIMEOUT_MS = 60000;

const PLACEHOLDER_PATTERNS = [
  /^your_/i, /你的/, /替换/, /xxxx/i, /example/i, /placeholder/i, /_here$/i
];

/**
 * 读取 TOKENHUB_API_KEY（占位符视为未配置）。
 */
function getApiKey() {
  const key = (process.env.TOKENHUB_API_KEY || '').trim();
  if (!key) return '';
  if (PLACEHOLDER_PATTERNS.some(re => re.test(key))) return '';
  return key;
}

function isConfigured() {
  return !!getApiKey();
}

/**
 * 图片地址规范化：TokenHub 的 image_url 只接受公网 URL 或 data URL。
 * 老调用链可能直接传裸 base64，这里统一补成 data URL。
 * @param {string} url http(s) URL / data URL / 裸 base64
 * @returns {string}
 */
function normalizeImageUrl(url) {
  const u = String(url || '');
  if (/^https?:\/\//i.test(u) || /^data:/i.test(u)) return u;
  return 'data:image/jpeg;base64,' + u;
}

/**
 * OpenAI 兼容 Chat Completions（非流式）。
 * @param {Object} opts
 * @param {Array<{role:string, content:string|Array<Object>}>} opts.messages
 *   OpenAI 原生格式（小写 role）：
 *   - 纯文本轮：content 为字符串
 *   - 含图轮：content 为数组
 *     [{type:'image_url', image_url:{url}}, {type:'text', text}]
 *     （多图并列多个 image_url 块即可；第一轮带图、后续纯文本的既有约定不变）
 * @param {string} [opts.model] 默认 DEFAULT_MODEL
 * @param {number} [opts.timeoutMs] 默认 60000
 * @returns {Promise<string>} 首个 choice 的 message.content 文本
 */
function chatCompletion(opts) {
  const apiKey = getApiKey();
  if (!apiKey) {
    return Promise.reject(new Error('TOKENHUB_API_KEY 未配置'));
  }

  const body = JSON.stringify({
    model: opts.model || DEFAULT_MODEL,
    messages: opts.messages,
    stream: false
  });

  return new Promise((resolve, reject) => {
    const req = https.request(`${BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Authorization': `Bearer ${apiKey}`
      },
      timeout: opts.timeoutMs || DEFAULT_TIMEOUT_MS
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (e) { /* 非 JSON 走下方 HTTP 状态分支 */ }
        if (res.statusCode !== 200) {
          const msg = (json && json.error && json.error.message) || `HTTP ${res.statusCode}`;
          reject(new Error(msg));
          return;
        }
        if (!json || !json.choices || !json.choices.length || !json.choices[0].message) {
          reject(new Error('AI 返回为空'));
          return;
        }
        // 防御：多数兼容层返回字符串，个别返回分段数组
        let content = json.choices[0].message.content;
        if (Array.isArray(content)) {
          content = content.map(p => (p && p.text) || '').join('');
        }
        if (typeof content === 'string' && content.trim()) {
          resolve(content.trim());
        } else {
          reject(new Error('AI 未返回有效内容'));
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('AI 请求超时')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

module.exports = {
  chatCompletion,
  normalizeImageUrl,
  isConfigured,
  getApiKey,
  DEFAULT_MODEL
};
