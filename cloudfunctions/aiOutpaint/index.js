// cloudfunctions/aiOutpaint/index.js
// AI 扩图云函数 —— 腾讯混元生图 ImageOutpainting（同步调用）
//
// 定位：按指定宽高比智能扩展画面（补全背景 / 改比例），与 crop/splice 形成"画面延展"互补。
//
// 接口：client.ImageOutpainting({ InputUrl, Ratio, RspImgType:'base64', LogoAdd:1 })
//   - RspImgType 用 base64（官方默认值；对齐 aiStyleTransfer，免额外 HTTP 下载）。
//     spec 字面写 'url'，但 url 仅 1 小时有效期且需二次下载；base64 直接拿到结果字节
//     存自己云存储返 fileID，同样满足"不把过期 url 返前端"的约束，且更稳。详见全局约束 #9。
//   - LogoAdd=1 保持默认：结果图右下角"图片由 AI 生成"——深度合成类目合规义务，不隐藏。
//
// 诚信约定（对齐 aiCaption / aiMatting）：
//   1. 密钥未配置 → 返 demo（原图 fileID + demo:true），前端标注"示例：扩图需配置 AI 密钥"。
//   2. 密钥已配置但调用 / 解析失败 → success:false + 归一化错误，绝不静默伪造扩图结果。
//
// 限流：复用统一模块 rate-limiter，featureKey='outpaint'，每功能独立计数。
//      限额走环境变量 RATE_LIMIT_DAILY（缺省 20），控制台可改免重新部署。
// 内容安全：服务端 assertImageSafe 兜底（前端 guardImage 为主）。
// 时区：云函数跑 UTC，按日计数用北京时间。

const cloud = require('wx-server-sdk');
const tencentcloud = require('tencentcloud-sdk-nodejs');
const secret = require('./cloud-secret');
const contentCheck = require('./content-check');
const rateLimiter = require('./rate-limiter');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const AiartClient = tencentcloud.aiart.v20221229.Client; // 与 aiStyleTransfer 同源
const FEATURE_KEY = 'outpaint';
const SUPPORTED_RATIOS = ['1:1', '4:3', '3:4', '16:9', '9:16'];

/**
 * AI 扩图
 * @param {Object} event
 *   - 默认（或 action:'outpaint'）: { fileID, ratio } → 执行扩图
 *   - action:'quota': 只读当日已用次数，不计数、不消耗额度（前端进页面展示额度条用）
 * @returns {Object} - { success, fileID, demo?, used?, limit? | error?, errorCode? }
 */
exports.main = async (event, context) => {
  const action = event.action || 'outpaint';

  // 轻量查询分支：只读 rate_limit 当日计数，不 inc、不消耗额度
  if (action === 'quota') {
    const wxCtxQ = cloud.getWXContext();
    const openidQ = wxCtxQ && wxCtxQ.OPENID;
    // 密钥未配置 → demo:true（前端不展示额度条）
    if (!secret.getCredentials().available) {
      return { success: true, demo: true, used: 0, limit: rateLimiter.resolveLimit() };
    }
    const q = await rateLimiter.queryQuota(openidQ, FEATURE_KEY, cloud);
    return q; // { success, used, limit, degraded?, reason? }
  }

  const { fileID, ratio } = event;

  try {
    if (!fileID) {
      return { success: false, error: '缺少图片参数' };
    }
    if (!ratio || !SUPPORTED_RATIOS.includes(ratio)) {
      return { success: false, error: '请选择有效的扩图比例' };
    }

    const wxCtx = cloud.getWXContext();
    const openid = wxCtx && wxCtx.OPENID;

    // 密钥未配置 → demo（返原图 fileID + demo:true，前端标注"示例"）
    const cred = secret.getCredentials();
    if (!cred.available) {
      return { success: true, fileID: fileID, demo: true };
    }

    // 1. 下载原图 → 服务端内容安全兜底（违规则抛错，外层转标准化提示）
    const dl = await cloud.downloadFile({ fileID });
    const imageBuffer = dl.fileContent;
    await contentCheck.assertImageSafe(imageBuffer, cloud, detectContentType(fileID));

    // 2. 二次校验：Ratio 必须 ≠ 原图比例（前端预校验为主，此处兜底防绕过）
    const dim = parseImageDimensions(imageBuffer);
    if (dim && isSameRatio(dim.width, dim.height, ratio)) {
      return { success: false, error: '扩图比例不能与原图相同，请换一个比例' };
    }

    // 3. 限流（通过内容安全 / 比例校验后再计数，避免无效请求消耗额度）
    const rl = await rateLimiter.checkRateLimit(openid, FEATURE_KEY, cloud);
    console.log('[aiOutpaint] checkRateLimit 结果', { openid, rl });
    if (!rl.ok) {
      return {
        success: false,
        error: 'rate_limit',
        limit: rl.limit,
        used: rl.used,
        resetAt: '次日0点'
      };
    }

    // 4. 拿公网 URL（ImageOutpainting 的 InputUrl 需公网可访问，不接受 base64 data URL）
    const urlResult = await cloud.getTempFileURL({ fileList: [fileID] });
    const imageURL = urlResult.fileList[0] && urlResult.fileList[0].tempFileURL;
    if (!imageURL) {
      throw new Error('获取图片地址失败');
    }

    // 5. 调 ImageOutpainting（同步，约 10–30s，config.json timeout:60）
    const client = newClient(cred);
    const response = await client.ImageOutpainting({
      InputUrl: imageURL,
      Ratio: ratio,
      RspImgType: 'base64',
      LogoAdd: 1
    });

    const resultBase64 = response && response.ResultImage;
    if (!resultBase64) {
      throw new Error('AI 返回为空');
    }

    // 6. 存自己云存储 → 返新 fileID（不把过期 url 返前端）
    const resultBuffer = Buffer.from(resultBase64, 'base64');
    const upload = await cloud.uploadFile({
      cloudPath: `aiOutpaint/${Date.now()}_${ratio.replace(':', 'x')}.jpg`,
      fileContent: resultBuffer
    });

    return {
      success: true,
      fileID: upload.fileID,
      demo: false,
      used: rl.used,
      limit: rl.limit,
      degraded: !!rl.degraded,
      rlReason: rl.reason || ''
    };
  } catch (err) {
    console.error('[aiOutpaint] 扩图失败', err);
    const normalized = normalizeError(err);
    return { success: false, error: normalized.message, errorCode: normalized.code };
  }
};

/**
 * 构造 aiart 客户端（与 aiStyleTransfer 同源，TC3 签名）
 */
function newClient(cred) {
  return new AiartClient({
    credential: { secretId: cred.secretId, secretKey: cred.secretKey },
    region: cred.region,
    profile: { signMethod: 'TC3-HMAC-SHA256' }
  });
}

/**
 * 错误归一化：把腾讯云 / 内部错误映射为面向用户的友好文案 + errorCode。
 * ImageOutpainting 暂无业务错误码，按公共错误码 + 消息特征兜底匹配。
 *  - JobNumExceed（默认并发 1）→ "生成排队中"
 *  - 违规（ImageIllegalDetected / 86414）→ 标准化违规提示（不暴露原因）
 *  - 超时 → "超时请重试"
 *  - 其他 → "扩图失败请重试"
 */
function normalizeError(err) {
  const msg = String((err && err.message) || (err && err.errMsg) || '');
  const code = String((err && err.code) || '');
  const bucket = msg + ' ' + code;

  if (/JobNumExceed|RequestLimitExceeded|并发|排队/i.test(bucket)) {
    return { message: '生成排队中，请稍候重试', code: 'JobNumExceed' };
  }
  if (/ImageIllegalDetected|违规|risk|illegal|86414/i.test(bucket)) {
    return { message: '图片可能包含违规内容，请更换后重试', code: 'ImageIllegalDetected' };
  }
  if (/超时|timeout|timed out/i.test(bucket)) {
    return { message: 'AI 扩图超时，请重试', code: 'Timeout' };
  }
  return { message: '扩图失败，请重试', code: 'Unknown' };
}

/**
 * 比例相同判定（带 2% 相对容差，避免浮点 / 微差误判）
 */
function isSameRatio(w, h, ratioStr) {
  const parts = ratioStr.split(':').map(Number);
  const target = parts[0] / parts[1];
  const actual = w / h;
  return Math.abs(actual - target) / target < 0.02;
}

/**
 * 从 buffer 解析图片宽高（仅 JPEG / PNG；其余格式返回 null，交由 API 兜底）。
 * 用于云函数侧的二次比例校验，无需引入 sharp 等原生依赖。
 */
function parseImageDimensions(buf) {
  if (!buf || buf.length < 24) return null;
  try {
    // PNG: 89 50 4E 47 0D 0A 1A 0A ... IHDR 宽高在 16/20 偏移
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    // JPEG: FF D8 ... 扫描 SOF0/SOF2 等帧头取宽高
    if (buf[0] === 0xff && buf[1] === 0xd8) {
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) { i++; continue; }
        const marker = buf[i + 1];
        // SOF0~SOF15（剔除 DHT=0xC4 / JPG=0xC8 / DAC=0xCC）
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          const height = buf.readUInt16BE(i + 5);
          const width = buf.readUInt16BE(i + 7);
          return { width, height };
        }
        const segLen = buf.readUInt16BE(i + 2);
        i += 2 + segLen;
      }
    }
  } catch (e) {
    console.warn('[aiOutpaint] 解析图片尺寸失败，跳过二次比例校验', e.message);
  }
  return null;
}

/**
 * 从 fileID / 文件名推断 MIME（仅用于内容安全送检）
 */
function detectContentType(fileID) {
  const s = String(fileID || '').toLowerCase();
  if (s.endsWith('.png')) return 'image/png';
  if (s.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

