// cloudfunctions/aiAvatar/index.js
// AI 百变头像云函数 —— 腾讯混元生图 GenerateAvatar（同步调用）
//
// 定位：输入人像 / 动物照片 → 生成风格百变的头像 / 萌宠贴纸。社交刚需 + 爆款 pattern。
//
// 接口：client.GenerateAvatar({ InputUrl, Type, Style, Filter:1, RspImgType:'base64', LogoAdd:1 })
//   - Type: 'human'(人像头像，仅人像) / 'pet'(萌宠贴纸，仅动物)。前端二选一。
//   - Style: 仅 human 生效；取值见官方「百变头像风格列表」15 个风格编号（不臆造）。
//            来源 https://cloud.tencent.com/document/product/1668/107741 ；不传默认 flower。
//   - Filter:1 开启人像质量检测（无人 / 多人 / 人脸过小 / 遮挡 → 拦截），建议开启。
//   - RspImgType 用 base64（官方默认；对齐 aiOutpaint / aiStyleTransfer，免二次下载）。
//     spec 字面写 'url'，但 url 仅 1 小时有效期且需二次下载；base64 直接拿到结果字节
//     存自己云存储返 fileID，同样满足「不把过期 url 返前端」约束，且更稳。详见全局约束 #9。
//   - LogoAdd=1 保持默认：结果图右下角「图片由 AI 生成」——深度合成类目合规义务，不隐藏。
//
// 诚信约定（对齐 aiOutpaint / aiCaption）：
//   1. 密钥未配置 → 返 demo（原图 fileID + demo:true），前端标注「示例：头像生成需配置 AI 密钥」。
//   2. 密钥已配置但调用 / 解析失败 → success:false + 归一化错误，绝不静默伪造头像结果。
//
// 限流：复用统一模块 rate-limiter，featureKey='avatar'，每功能独立计数。
//      限额走环境变量 RATE_LIMIT_DAILY（缺省 20），控制台可改免重新部署。
// 内容安全：服务端 assertImageSafe 兜底（前端 guardImage 为主）。
// 时区：云函数跑 UTC，按日计数用北京时间。

const cloud = require('wx-server-sdk');
const tencentcloud = require('tencentcloud-sdk-nodejs');
const secret = require('./cloud-secret');
const contentCheck = require('./content-check');
const rateLimiter = require('./rate-limiter');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const AiartClient = tencentcloud.aiart.v20221229.Client; // 与 aiStyleTransfer / aiOutpaint 同源
const FEATURE_KEY = 'avatar';
const TYPE_HUMAN = 'human';
const TYPE_PET = 'pet';

// 官方「百变头像风格列表」15 个风格编号（仅 human 模式生效；不臆造）。
// 来源：https://cloud.tencent.com/document/product/1668/107741
const STYLE_CODES = [
  'flower', 'babi', 'commerce', 'wedding', 'gufeng',
  'coin', 'water', 'retro', 'amusement', 'astronaut',
  'cartoon', 'star', 'dopamine', 'comic', 'beach'
];
const DEFAULT_STYLE = 'flower';

/**
 * AI 百变头像
 * @param {Object} event
 *   - 默认（或 action:'generate'）: { fileID, type:'human'|'pet', style? } → 生成头像
 *       type 缺省按 'human'；style 仅 human 生效，须为 STYLE_CODES 之一，缺省 'flower'。
 *   - action:'quota': 只读当日已用次数，不计数、不消耗额度（前端进页面展示额度条用）
 * @returns {Object} - { success, fileID, demo?, used?, limit?, style?, type? | error?, errorCode?, hint? }
 */
exports.main = async (event, context) => {
  const action = event.action || 'generate';

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

  const { fileID, style } = event;
  // 在 try 外声明，使 catch 分支也能拿到（用于按模式给引导文案）
  const avatarType = (event.type === TYPE_PET) ? TYPE_PET : TYPE_HUMAN;

  try {
    if (!fileID) {
      return { success: false, error: '缺少图片参数' };
    }

    // 风格校验：human 须为白名单内；pet 不用风格
    let avatarStyle = DEFAULT_STYLE;
    if (avatarType === TYPE_HUMAN) {
      if (style && !STYLE_CODES.includes(style)) {
        return { success: false, error: '风格选择有误，请重新选择' };
      }
      if (style) avatarStyle = style;
    }

    const wxCtx = cloud.getWXContext();
    const openid = wxCtx && wxCtx.OPENID;

    // 密钥未配置 → demo（返原图 fileID + demo:true，前端标注「示例」）
    const cred = secret.getCredentials();
    if (!cred.available) {
      return { success: true, fileID: fileID, demo: true, type: avatarType, style: avatarStyle };
    }

    // 1. 下载原图 → 服务端内容安全兜底（违规则抛错，外层转标准化提示）
    const dl = await cloud.downloadFile({ fileID });
    const imageBuffer = dl.fileContent;
    await contentCheck.assertImageSafe(imageBuffer, cloud, detectContentType(fileID));

    // 2. 限流（通过内容安全后再计数，避免无效请求消耗额度）
    const rl = await rateLimiter.checkRateLimit(openid, FEATURE_KEY, cloud);
    console.log('[aiAvatar] checkRateLimit 结果', { openid, rl });
    if (!rl.ok) {
      return {
        success: false,
        error: 'rate_limit',
        limit: rl.limit,
        used: rl.used,
        resetAt: '次日0点'
      };
    }

    // 3. 拿公网 URL（GenerateAvatar 的 InputUrl 需公网可访问，不接受 base64 data URL）
    const urlResult = await cloud.getTempFileURL({ fileList: [fileID] });
    const imageURL = urlResult.fileList[0] && urlResult.fileList[0].tempFileURL;
    if (!imageURL) {
      throw new Error('获取图片地址失败');
    }

    // 4. 调 GenerateAvatar（同步，约 10–30s，config.json timeout:60）
    const client = newClient(cred);
    const params = {
      InputUrl: imageURL,
      Type: avatarType,
      RspImgType: 'base64',
      LogoAdd: 1
    };
    if (avatarType === TYPE_HUMAN) {
      params.Style = avatarStyle; // 仅 human 生效
      params.Filter = 1;          // 人像质量检测，无人/多人/人脸过小/遮挡 → 拦截
    }
    const response = await client.GenerateAvatar(params);

    const resultBase64 = response && response.ResultImage;
    if (!resultBase64) {
      throw new Error('AI 返回为空');
    }

    // 5. 存自己云存储 → 返新 fileID（不把过期 url 返前端）
    const resultBuffer = Buffer.from(resultBase64, 'base64');
    const suffix = avatarType === TYPE_PET ? 'pet' : avatarStyle;
    const upload = await cloud.uploadFile({
      cloudPath: `aiAvatar/${Date.now()}_${suffix}.jpg`,
      fileContent: resultBuffer
    });

    return {
      success: true,
      fileID: upload.fileID,
      demo: false,
      used: rl.used,
      limit: rl.limit,
      degraded: !!rl.degraded,
      rlReason: rl.reason || '',
      type: avatarType,
      style: avatarStyle
    };
  } catch (err) {
    console.error('[aiAvatar] 头像生成失败', err);
    const normalized = normalizeError(err, avatarType);
    return {
      success: false,
      error: normalized.message,
      errorCode: normalized.code,
      hint: normalized.hint || ''
    };
  }
};

/**
 * 构造 aiart 客户端（与 aiStyleTransfer / aiOutpaint 同源，TC3 签名）
 */
function newClient(cred) {
  return new AiartClient({
    credential: { secretId: cred.secretId, secretKey: cred.secretKey },
    region: cred.region,
    profile: { signMethod: 'TC3-HMAC-SHA256' }
  });
}

/**
 * 错误归一化：把腾讯云错误码 / 消息映射为面向用户的友好文案 + errorCode + 可选 hint。
 * GenerateAvatar 有业务错误码（与 ImageOutpainting 不同），优先按 err.code 精确匹配。
 *  - JobNumExceed（默认并发 1）→ 「生成排队中」
 *  - 违规（ImageIllegalDetected / 86414）→ 标准化违规提示（不暴露原因）
 *  - 分辨率过低（InvalidParameter，消息含「分辨率过低」）→ 引导上传更清晰照片
 *  - 人像质检拦截（消息含 人脸/face/多人/遮挡 等）→ 引导重新上传（spec 4.3：不裸抛质检错误）
 *  - 风格冲突 / 图片问题 / 超时 / 计费 / 内部错误 → 各自友好文案
 *
 * 注意：腾讯 SDK 返回的 code 是精确大小写（如 InvalidParameter.InvalidParameter），
 * 故 bucket 不再 toLowerCase，统一用 i 标志做大小写不敏感匹配（中文不受影响）。
 */
function normalizeError(err, avatarType) {
  const code = String((err && err.code) || '');
  const msg = String((err && err.message) || '');
  const bucket = code + ' ' + msg;

  // 并发超限（默认并发 1）
  if (/JobNumExceed|RequestLimitExceeded|并发|排队/i.test(bucket)) {
    return { message: '生成排队中，请稍候重试', code: 'JobNumExceed' };
  }
  // 违规（输入图或文本审核不通过）—— 标准化提示，绝不暴露原因 / label
  if (/ImageIllegalDetected|TextIllegalDetected|illegal|违规|86414/i.test(bucket)) {
    return { message: '图片可能包含违规内容，请更换后重试', code: 'ImageIllegalDetected' };
  }
  // 分辨率过低（InvalidParameter，消息含「分辨率过低 / 过小」）—— 引导上传更清晰照片
  if (/分辨率过低|分辨率过小|resolution.*(low|small)|too small/i.test(bucket)) {
    return {
      message: '照片分辨率过低，请上传更清晰的照片',
      hint: '建议使用单边 500 像素以上的清晰正面照',
      code: 'ImageResolutionLow'
    };
  }
  // 人像质量检测拦截（Filter=1：无人 / 多人 / 人脸过小 / 遮挡）—— 给引导而非裸抛
  // 仅在消息明确指向「人脸 / 质检」时判定，避免把生成审核失败误判为质检
  if (avatarType === TYPE_HUMAN &&
      /质检|人脸|face|no face|nobody|多人|multi|遮挡|quality|portrait/i.test(bucket)) {
    return {
      message: '未检测到清晰人像，请重新上传',
      hint: '请使用正面、单人、人脸占比大的清晰照片，避免侧脸 / 多人 / 遮挡',
      code: 'FaceQuality'
    };
  }
  // 风格冲突（单风格不应触发，兜底）
  if (/StyleConflict/i.test(bucket)) {
    return { message: '风格选择有误，请重新选择', code: 'StyleConflict' };
  }
  // 图片本身问题
  if (/ImageDecodeFailed|ImageDownloadError|ImageEmpty|UrlIllegal/i.test(bucket)) {
    return { message: '图片读取失败，请重新上传', code: 'ImageError' };
  }
  if (/ImageResolutionExceed|分辨率过大|resolution.*exceed/i.test(bucket)) {
    return { message: '图片分辨率过大，请压缩后重试', code: 'ImageTooLarge' };
  }
  if (/ImageSizeExceed|RequestEntityTooLarge|too large|过大/i.test(bucket)) {
    return { message: '图片过大，请压缩后重试', code: 'ImageTooLarge' };
  }
  // 超时
  if (/RequestTimeout|timeout|timed out|超时/i.test(bucket)) {
    return { message: 'AI 处理超时，请重试', code: 'Timeout' };
  }
  // 计费 / 服务未开通
  if (/InArrears|LowBalance|StopUsing|NotExist|Delivering|ChargeStatusException|ResourceUnavailable/i.test(bucket)) {
    return { message: 'AI 服务暂不可用，请稍后重试', code: 'ServiceUnavailable' };
  }
  // 参数 / 生成失败 / 内部错误 —— 中性文案 + 按模式给引导（不暗示违规）
  if (/InnerError|ServerError|RpcFail|Unknown|FailedOperation|InvalidParameter|ParameterValueError/i.test(bucket)) {
    const hint = avatarType === TYPE_PET
      ? '请上传清晰的动物照片，避免多只动物或动物过小'
      : '可尝试更换照片或风格后重试';
    return { message: 'AI 生成失败，请重试', hint, code: 'GenerateFailed' };
  }
  return { message: '头像生成失败，请重试', code: 'Unknown' };
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
