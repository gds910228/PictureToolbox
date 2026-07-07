// cloudfunctions/aiMatting/index.js
// AI智能抠图云函数 - 腾讯云人像分割（SegmentPortraitPic）
//
// 安全/诚实性约定：
// 1. 调腾讯云 SegmentPortraitPic（人像分割接口，实测对动物等主体亦有泛化效果）。
//    API 失败 → success:false + 标准化错误，绝不回退"返原图+假识别"伪装成功。
//    密钥未配置 → assertCredentials 抛错 → success:false。
// 2. 不返回伪造的 confidence / recognition（SegmentPortraitPic 不提供识别置信度）。
// 3. 服务端内容安全兜底：下载原图过 assertImageSafe，违规即拒（不暴露原因）。

const cloud = require('wx-server-sdk');
const tencentcloud = require('tencentcloud-sdk-nodejs');
const secret = require('./cloud-secret');
const contentCheck = require('./content-check');
const rateLimiter = require('./rate-limiter');

// 初始化云开发环境
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const FEATURE_KEY = 'matting';

/**
 * AI智能抠图（人像分割）
 * @param {event} Object - { fileID: string, type?: string, action?: 'quota' }
 * @returns {Object} - { success, fileID, type, typeName | error }
 */
exports.main = async (event, context) => {
  const action = event.action || 'matting';

  // 轻量查询分支：只读当日抠图额度，不计数、不消耗（前端进页面展示额度条用）
  if (action === 'quota') {
    const wxCtxQ = cloud.getWXContext();
    const openidQ = wxCtxQ && wxCtxQ.OPENID;
    if (!secret.getCredentials().available) {
      return { success: true, demo: true, used: 0, limit: rateLimiter.resolveLimit() };
    }
    return await rateLimiter.queryQuota(openidQ, FEATURE_KEY, cloud);
  }

  const { fileID, type = 'portrait' } = event;


  try {
    if (!fileID) {
      return {
        success: false,
        error: '缺少图片参数'
      };
    }

    // 入口检查密钥（控制台环境变量优先）；未配置则抛错，外层 catch 返回失败
    const cred = secret.assertCredentials();

    // 取调用者 openid（用于限流）
    const wxCtx = cloud.getWXContext();
    const openid = wxCtx && wxCtx.OPENID;

    // 下载图片
    const downloadResult = await cloud.downloadFile({
      fileID: fileID
    });

    const imageBuffer = downloadResult.fileContent;

    // 服务端内容安全兜底（违规则抛错，外层 catch 返回失败）
    await contentCheck.assertImageSafe(imageBuffer, cloud);

    // 限流（通过内容安全后再计数，避免无效请求消耗额度）
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

    // 真实抠图：SegmentPortraitPic（人像分割接口，实测对动物等主体亦有泛化效果）。
    // 失败抛错，不再回退"返原图+识别"伪装成功。
    const mattingFileID = await callTencentMattingAPI(imageBuffer, cred);


    return {
      success: true,
      fileID: mattingFileID,
      type: type,
      typeName: '智能抠图',
      used: rl.used,
      limit: rl.limit
    };

  } catch (err) {
    console.error('AI智能抠图失败', err);
    return {
      success: false,
      error: normalizeMattingError(err)
    };
  }
};

/**
 * 调用腾讯云人像分割 API（人体分析服务 SegmentPortraitPic，实测对动物等主体亦有泛化效果）。
 * 成功返回上传后的 fileID；失败抛错（由主流程 catch 标准化）。
 * API文档：https://cloud.tencent.com/document/api/1208/42970
 */
async function callTencentMattingAPI(imageBuffer, cred) {
  // 将图片转为base64
  const base64Image = imageBuffer.toString('base64');

  // 使用腾讯云人体分析服务的SDK
  const BdaClient = tencentcloud.bda.v20200324.Client;

  const client = new BdaClient({
    credential: {
      secretId: cred.secretId,
      secretKey: cred.secretKey,
    },
    region: cred.region,
    profile: {
      signMethod: "TC3-HMAC-SHA256",
    }
  });

  // 调用人像分割API
  const params = {
    Image: base64Image,
    RspImgType: "base64"  // 返回base64格式的透明背景图
  };

  const response = await client.SegmentPortraitPic(params);

  if (!response || !response.ResultImage || response.ResultImage.length === 0) {
    // 常见于图中未检测到人像 → 抛出可识别错误，由 normalizeMattingError 转友好提示
    throw new Error('NoPersonDetected');
  }

  // API返回了抠图结果（透明背景PNG的base64数据）
  const mattingImageBuffer = Buffer.from(response.ResultImage, 'base64');

  // 上传抠图后的图片到云存储
  const uploadResult = await cloud.uploadFile({
    cloudPath: `matting/${Date.now()}.png`,
    fileContent: mattingImageBuffer
  });


  return uploadResult.fileID;
}

/**
 * 标准化抠图错误信息（不暴露内部原因/密钥信息）：
 *  - 无主体迹象（未检测到人像/返回空）→ 引导上传人像照
 *  - 其他 API 异常 → 通用重试提示
 * 注：SegmentPortraitPic 对非人像图的具体错误码需真机校准关键词匹配。
 */
function normalizeMattingError(err) {
  const msg = String((err && (err.message || err.errMsg)) || '');
  const noPerson = /noperson|no person|空|empty|人体|人像|portrait|未检测|未识别/i;
  if (noPerson.test(msg)) {
    return '未检测到清晰主体，请上传主体突出的图片重试';
  }
  return 'AI 抠图暂时不可用，请稍后重试';
}
