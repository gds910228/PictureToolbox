// cloudfunctions/aiTextToImage/index.js
// AI 文生图云函数 —— 腾讯混元生图 3.0（异步双 action）+ VLM 辅助写 prompt
//
// 定位：顶级流量入口。差异化在于用 hunyuan-vision（免费 10 亿 token）看参考图 / 模糊需求
//      自动写专业 prompt，再交混元 3.0 生图——降低"不会写 prompt"的摩擦。
//
// 四个 action（单云函数承载，对齐 aiUpscale 异步模式 + aiOutpaint 诚信 / 限流约定）：
//   action:'submit'（默认）: 收 prompt + 参考图(≤3) + 比例 → 内容安全 → 限流 → SubmitTextToImageJob → 返 JobId
//   action:'query':         按 JobId 轮询 QueryTextToImageJob → running / done(下载结果存云存储返 fileID) / fail
//   action:'quota':         只读当日已用次数（前端进页面展示额度条），不计数
//   action:'enhancePrompt': VLM 辅助写 prompt（看可选参考图 + 模糊需求 → 专业生图 prompt），走免费 token，不限流
//
// 接口字段（以官方 API 实测为准，非 spec 字面）：
//   SubmitTextToImageJob({ Prompt, Images.N(字符串数组, Base64 或 Url), Resolution, Revise:1, LogoAdd:1 }) → { JobId }
//   QueryTextToImageJob({ JobId }) → { JobStatusCode('1'等待/'2'运行/'4'失败/'5'完成), JobStatusMsg,
//                                       JobErrorCode, JobErrorMsg, ResultImage(Url 数组, 1h 有效), RevisedPrompt }
//   注意：异步任务接口无 RspImgType 参数，ResultImage 恒为 Url 数组且 1h 过期 → done 时必须下载 + 存自己云存储返 fileID。
//
// 诚信约定（对齐 aiCaption / aiOutpaint）：
//   1. 密钥未配置 → enhance/submit 返 demo:true（前端标注"示例"，submit 不轮询不伪造图）；query 不应在 demo 态被调用。
//   2. 密钥已配置但调用 / 解析失败 → success:false + 归一化错误，绝不静默伪造生成图。
//
// 内容安全双层：参考图走 assertImageSafe（imgSecCheck）；prompt 文本走服务端 msgSecCheck（assertTextSafe）。
//   违规 → 标准化提示，绝不暴露 label / 原因；服务异常 FAIL_OPEN 放行（腾讯侧仍会兜底拒违规）。
// 合规：LogoAdd=1 保持默认（结果图"图片由 AI 生成"水印，深度合成类目义务，不隐藏）。
// 限流：featureKey='text2img'，每功能独立计数；限额走环境变量 RATE_LIMIT_DAILY（缺省 20）。
//      仅 submit 计数（query 轮询 / enhance 辅助不消耗生图额度）。时区：云函数跑 UTC，按日计数用北京时间。

const cloud = require('wx-server-sdk');
const https = require('https');
const http = require('http');
const tencentcloud = require('tencentcloud-sdk-nodejs');
const secret = require('./cloud-secret');
const contentCheck = require('./content-check');
const rateLimiter = require('./rate-limiter');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const AiartClient = tencentcloud.aiart.v20221229.Client; // 与 aiStyleTransfer / aiOutpaint 同源
const HunyuanClient = tencentcloud.hunyuan.v20230901.Client; // VLM 辅助写 prompt
const FEATURE_KEY = 'text2img';

// 比例 → 官方尺寸列表中的合法 Resolution（均为 API 文档「尺寸列表」内取值）
const RATIO_RESOLUTION = {
  '1:1': '1024:1024',
  '4:3': '1024:768',
  '3:4': '768:1024',
  '16:9': '1280:720',
  '9:16': '720:1280'
};
const DEFAULT_RESOLUTION = '1024:1024';
const MAX_REFERENCES = 3;
const MAX_PROMPT_LEN = 2000; // 送检 / 透传上限（API 上限 8192，前端输入框已限更短）

/**
 * AI 文生图主入口
 * @param {Object} event
 *   - action:'submit'（默认）: { prompt, referenceFileIDs?, ratio? }
 *   - action:'query':         { taskId }
 *   - action:'quota':         无参
 *   - action:'enhancePrompt': { idea?, referenceFileIDs? }
 * @returns {Object}
 *   submit → { success, taskId?, demo?, used?, limit? | error?, errorCode? }
 *   query  → { success, status:'running'|'done'|'fail', fileID?, error?, errorCode? }
 *   quota  → { success, used, limit, demo? }
 *   enhance→ { success, prompt?, demo? | error? }
 */
exports.main = async (event, context) => {
  const action = event.action || 'submit';

  // ---- 只读额度查询（不计数、不消耗） ----
  if (action === 'quota') {
    const wxCtxQ = cloud.getWXContext();
    const openidQ = wxCtxQ && wxCtxQ.OPENID;
    if (!secret.getCredentials().available) {
      return { success: true, demo: true, used: 0, limit: rateLimiter.resolveLimit() };
    }
    return await rateLimiter.queryQuota(openidQ, FEATURE_KEY, cloud);
  }

  if (action === 'query') {
    return await queryTask(event);
  }

  if (action === 'enhancePrompt') {
    return await enhancePrompt(event);
  }

  return await submitTask(event);
};

// ============================================================
// submit：提交文生图任务
// ============================================================
async function submitTask(event) {
  const { prompt, referenceFileIDs, ratio } = event;

  try {
    // 1. 参数校验
    const promptText = String(prompt || '').trim();
    if (!promptText) {
      return { success: false, error: '请输入提示词' };
    }
    if (promptText.length > MAX_PROMPT_LEN) {
      return { success: false, error: '提示词过长，请精简后重试' };
    }

    const wxCtx = cloud.getWXContext();
    const openid = wxCtx && wxCtx.OPENID;

    // 2. 密钥未配置 → demo（不轮询、不伪造图，前端标注"示例"）
    const cred = secret.getCredentials();
    if (!cred.available) {
      return { success: true, demo: true };
    }

    // 3. 参考图：每张 downloadFile + 服务端 imgSecCheck + getTempFileURL → 组成 Images.N（公网 Url 数组）
    const refs = Array.isArray(referenceFileIDs) ? referenceFileIDs.slice(0, MAX_REFERENCES) : [];
    const imageUrls = [];
    for (const refFileID of refs) {
      if (!refFileID) continue;
      const dl = await cloud.downloadFile({ fileID: refFileID });
      await contentCheck.assertImageSafe(dl.fileContent, cloud, detectContentType(refFileID));
      const urlRes = await cloud.getTempFileURL({ fileList: [refFileID] });
      const u = urlRes.fileList[0] && urlRes.fileList[0].tempFileURL;
      if (!u) throw new Error('参考图地址获取失败');
      imageUrls.push(u);
    }

    // 4. prompt 服务端文本内容安全（msgSecCheck，违规抛标准化错误，异常 FAIL_OPEN）
    await assertTextSafe(promptText, cloud);

    // 5. 限流（通过内容安全后再计数，避免无效请求消耗额度；失败不退还，防恶意重试刷）
    const rl = await rateLimiter.checkRateLimit(openid, FEATURE_KEY, cloud);
    console.log('[aiTextToImage] checkRateLimit 结果', { openid, rl });
    if (!rl.ok) {
      return {
        success: false,
        error: 'rate_limit',
        limit: rl.limit,
        used: rl.used,
        resetAt: '次日0点'
      };
    }

    // 6. 比例 → Resolution（服务端单点映射，便于按官方尺寸列表更新）
    const resolution = RATIO_RESOLUTION[ratio] || DEFAULT_RESOLUTION;

    // 7. 提交任务（Revise:1 开启 prompt 改写，官方建议默认开，预计增加约 20s 生成耗时——异步轮询不影响 submit 返回速度）
    const client = newClient(cred);
    const params = {
      Prompt: promptText,
      Resolution: resolution,
      Revise: 1,
      LogoAdd: 1
    };
    if (imageUrls.length > 0) params.Images = imageUrls;

    const response = await client.SubmitTextToImageJob(params);
    const jobId = response && response.JobId;
    if (!jobId) {
      throw new Error('AI 未返回任务 ID');
    }

    return {
      success: true,
      taskId: jobId,
      used: rl.used,
      limit: rl.limit,
      degraded: !!rl.degraded,
      rlReason: rl.reason || ''
    };
  } catch (err) {
    console.error('[aiTextToImage] 提交任务失败', err);
    const normalized = normalizeError(err);
    return { success: false, error: normalized.message, errorCode: normalized.code };
  }
}

// ============================================================
// query：轮询任务状态
// ============================================================
async function queryTask(event) {
  const { taskId } = event;
  if (!taskId) {
    return { success: false, status: 'fail', error: '缺少任务 ID' };
  }

  try {
    const cred = secret.getCredentials();
    // query 在 demo 态不应被调用（submit demo 已让前端停止轮询）；防御性兜底
    if (!cred.available) {
      return { success: false, status: 'fail', error: 'AI 绘图服务未配置' };
    }

    const client = newClient(cred);
    const resp = await client.QueryTextToImageJob({ JobId: taskId });
    const r = (resp && resp.Response) || resp || {};
    const code = String(r.JobStatusCode || ''); // '1'等待 '2'运行 '4'失败 '5'完成

    // 失败
    if (code === '4') {
      const f = normalizeJobFailure(r.JobErrorCode, r.JobErrorMsg);
      return { success: false, status: 'fail', error: f.message, errorCode: f.code };
    }

    // 完成：下载 ResultImage[0]（Url 数组，1h 过期）→ 存自己云存储 → 返 fileID
    if (code === '5') {
      const imgs = Array.isArray(r.ResultImage) ? r.ResultImage : [];
      const resultUrl = imgs[0];
      if (!resultUrl) {
        return { success: false, status: 'fail', error: '生成成功但结果为空，请重试' };
      }
      const buffer = await fetchToBuffer(resultUrl);
      const upload = await cloud.uploadFile({
        cloudPath: `aiTextToImage/${Date.now()}.jpg`,
        fileContent: buffer
      });
      // RevisedPrompt 可能为空（关闭改写时返原 prompt），透传给前端展示（可选）
      const revised = Array.isArray(r.RevisedPrompt) && r.RevisedPrompt[0] ? r.RevisedPrompt[0] : '';
      return { success: true, status: 'done', fileID: upload.fileID, revisedPrompt: revised };
    }

    // '1' 等待 / '2' 运行 / 其他 → 继续轮询
    return { success: true, status: 'running' };
  } catch (err) {
    console.error('[aiTextToImage] 查询任务失败', err);
    const normalized = normalizeError(err);
    return { success: false, status: 'fail', error: normalized.message, errorCode: normalized.code };
  }
}

// ============================================================
// enhancePrompt：VLM 辅助写专业生图 prompt（走免费 10 亿 token，不限流）
// ============================================================
async function enhancePrompt(event) {
  const { idea, referenceFileIDs } = event;
  const ideaText = String(idea || '').trim().slice(0, 500);

  try {
    const cred = secret.getCredentials();

    // 参考图：最多取 1 张交给 VLM「看」（多图 VLM 也能看，但 1 张足够且省 token）
    let imageURL = '';
    const refs = Array.isArray(referenceFileIDs) ? referenceFileIDs.slice(0, 1) : [];
    if (refs.length > 0 && cred.available) {
      const refFileID = refs[0];
      const dl = await cloud.downloadFile({ fileID: refFileID });
      await contentCheck.assertImageSafe(dl.fileContent, cloud, detectContentType(refFileID));
      const urlRes = await cloud.getTempFileURL({ fileList: [refFileID] });
      imageURL = urlRes.fileList[0] && urlRes.fileList[0].tempFileURL;
    }

    // 密钥未配置 → 返固定示例 prompt + demo:true（前端标注"示例"）
    if (!cred.available) {
      return { success: true, demo: true, prompt: SAMPLE_PROMPT };
    }

    // 构造混元消息：有参考图用 Contents 数组（多模态），无参考图用 Content 字符串（纯文本）—— 不可混用
    const instruction = buildEnhanceInstruction(ideaText, !!imageURL);
    const messages = [];
    if (imageURL) {
      messages.push({
        Role: 'user',
        Contents: [
          { Type: 'image_url', ImageUrl: { Url: imageURL } },
          { Type: 'text', Text: instruction }
        ]
      });
    } else {
      messages.push({ Role: 'user', Content: instruction });
    }

    const client = new HunyuanClient({
      credential: { secretId: cred.secretId, secretKey: cred.secretKey },
      region: cred.region,
      profile: { signMethod: 'TC3-HMAC-SHA256' }
    });
    const resp = await client.ChatCompletions({
      Model: 'hunyuan-vision',
      Messages: messages,
      Stream: false
    });
    const result = (resp && resp.Response) || resp || {};
    const choice = result.Choices && result.Choices[0];
    const text = choice && choice.Message && String(choice.Message.Content).trim();
    if (!text) {
      return { success: false, error: 'AI 未能生成提示词，请重试' };
    }

    // 清理：去 markdown 代码块围栏 / 首尾引号 / 多余空白
    const cleaned = cleanPromptText(text);
    return { success: true, demo: false, prompt: cleaned };
  } catch (err) {
    console.error('[aiTextToImage] 辅助写 prompt 失败', err);
    return { success: false, error: 'AI 构思提示词失败，请稍后重试' };
  }
}

// ============================================================
// 辅助函数
// ============================================================

/**
 * 构造 aiart 客户端（TC3 签名，与 aiStyleTransfer / aiOutpaint 同源）
 */
function newClient(cred) {
  return new AiartClient({
    credential: { secretId: cred.secretId, secretKey: cred.secretKey },
    region: cred.region,
    profile: { signMethod: 'TC3-HMAC-SHA256' }
  });
}

/**
 * 构造 VLM「写 prompt」指令
 */
function buildEnhanceInstruction(idea, hasRef) {
  return [
    '你是一位专业的 AI 绘画提示词工程师。请根据下面的简短描述' +
      (hasRef ? '（并参考附图的主体与风格）' : '') +
      '，扩写为一段高质量的中文生图提示词，供腾讯混元文生图模型使用。',
    '',
    '要求：',
    '1. 涵盖主体、环境背景、艺术风格、构图、光影、色彩、画质等关键要素；',
    '2. 中文表达，150-300 字，语句流畅；',
    '3. 画面尽量不含文字（模型对文字渲染较弱）；',
    '4. 不得包含违规、敏感或真人相关信息；',
    '5. 只输出提示词正文本身，不要任何解释、前言、后记、引号或 markdown 代码块。',
    '',
    '简短描述：' + (idea || '（无具体描述，请自由发挥一个唯美、有氛围感的画面）')
  ].join('\n');
}

/**
 * 清理 VLM 返回：去 ``` 围栏、首尾引号、多余空白
 */
function cleanPromptText(text) {
  let t = String(text).trim();
  // 去 ``` / ```json 围栏
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  // 去首尾配对的中英引号
  if (/^["“]/.test(t) && /["”]$/.test(t)) {
    t = t.replace(/^["“]/, '').replace(/["”]$/, '');
  }
  return t.trim();
}

/**
 * 服务端文本内容安全（msgSecCheck）。违规抛标准化错误；服务异常 FAIL_OPEN 放行
 * （腾讯生图侧仍会以 OperationDenied.TextIllegalDetected 兜底拒违规）。
 */
async function assertTextSafe(text, cloud) {
  if (!text) return;
  let result;
  try {
    result = await cloud.openapi.security.msgSecCheck({ content: String(text).slice(0, 2500) });
  } catch (e) {
    const code = e && e.errCode;
    if (code === 86414 || (e && typeof e.errMsg === 'string' && /86414|risk/i.test(e.errMsg))) {
      throw new Error('提示词可能包含违规内容，请修改后重试');
    }
    console.error('[aiTextToImage] 文本检测异常，降级放行', e && (e.errCode || e.message));
    return;
  }
  if (result && result.errCode && result.errCode !== 0) {
    throw new Error('提示词可能包含违规内容，请修改后重试');
  }
  if (result && result.result && result.result.suggest === 'risky') {
    throw new Error('提示词可能包含违规内容，请修改后重试');
  }
}

/**
 * 把 SubmitTextToImageJob 抛出的错误归一化为友好文案 + errorCode
 *  - 文本违规（TextIllegalDetected）→ 标准化违规提示
 *  - 图片违规（ImageIllegalDetected）→ 参考图违规提示
 *  - 审核不通过（GenerateImageFailed）→ 标准化提示
 *  - 并发超限（JobNumExceed）→ 排队中
 *  - 频率限制（RequestLimitExceeded）→ 稍后重试
 *  - 计费 / 未开通（InArrears/LowBalance/NotExist/StopUsing）→ 服务未开通
 *  - 文本过长（TextLengthExceed）→ 精简提示
 *  - 超时 → 超时重试
 *  - 其他 → 生成失败请重试
 */
function normalizeError(err) {
  const msg = String((err && err.message) || (err && err.errMsg) || '');
  const code = String((err && err.code) || '');
  const bucket = msg + ' ' + code;

  if (/TextIllegalDetected/i.test(bucket)) {
    return { message: '提示词可能包含违规内容，请修改后重试', code: 'TextIllegalDetected' };
  }
  if (/ImageIllegalDetected|86414/i.test(bucket)) {
    return { message: '参考图可能包含违规内容，请更换后重试', code: 'ImageIllegalDetected' };
  }
  if (/GenerateImageFailed/i.test(bucket)) {
    return { message: '生成失败，提示词或参考图可能未通过审核，请修改后重试', code: 'GenerateImageFailed' };
  }
  if (/JobNumExceed|并发|排队/i.test(bucket)) {
    return { message: '生成排队中，请稍候重试', code: 'JobNumExceed' };
  }
  if (/RequestLimitExceeded|频率|频繁/i.test(bucket)) {
    return { message: '请求过于频繁，请稍候重试', code: 'RequestLimitExceeded' };
  }
  if (/InArrears|LowBalance|NotExist|StopUsing|ChargeStatusException|欠费|未开通|停服/i.test(bucket)) {
    return { message: 'AI 绘图服务暂不可用，请稍后重试', code: 'ServiceUnavailable' };
  }
  if (/TextLengthExceed|过长/i.test(bucket)) {
    return { message: '提示词过长，请精简后重试', code: 'TextLengthExceed' };
  }
  if (/超时|timeout|timed out|RequestTimeout/i.test(bucket)) {
    return { message: 'AI 生成超时，请重试', code: 'Timeout' };
  }
  return { message: '生成失败，请重试', code: 'Unknown' };
}

/**
 * query 侧任务失败归一化（JobStatusCode='4'）。JobErrorMsg 常为笼统"处理失败"，
 * 按 JobErrorCode / 消息特征匹配违规；其余按通用失败处理。
 */
function normalizeJobFailure(jobErrorCode, jobErrorMsg) {
  const bucket = String(jobErrorCode || '') + ' ' + String(jobErrorMsg || '');
  if (/ImageIllegalDetected|TextIllegalDetected|违规|illegal|审核|86414/i.test(bucket)) {
    return { message: '生成失败，提示词或参考图可能未通过审核，请修改后重试', code: 'AuditFailed' };
  }
  if (/ServerError|InnerError|RpcFail|Unknown|内部/i.test(bucket)) {
    return { message: 'AI 服务暂时开小差了，请稍后重试', code: 'ServerError' };
  }
  return { message: '生成失败，请重试或更换提示词', code: 'JobFailed' };
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

/**
 * 下载公网 Url 到 Buffer（无额外依赖；支持重定向与超时）。
 * 用于把 1h 过期的 ResultImage Url 落到自己云存储。
 */
function fetchToBuffer(url, redirects) {
  if (redirects === undefined) redirects = 0;
  return new Promise((resolve, reject) => {
    if (redirects > 5) {
      reject(new Error('下载结果图失败：重定向次数过多'));
      return;
    }
    const lib = String(url).indexOf('https:') === 0 ? https : http;
    const req = lib.get(url, { timeout: 30000 }, (res) => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        resolve(fetchToBuffer(next, redirects + 1));
        return;
      }
      if (status !== 200) {
        res.resume();
        reject(new Error('下载结果图失败：HTTP ' + status));
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('timeout', () => {
      req.destroy(new Error('下载结果图超时'));
    });
    req.on('error', reject);
  });
}

// 密钥未配置时的示例 prompt（demo 态返回，前端标注"示例"）
const SAMPLE_PROMPT =
  '一只橘色的猫咪戴着赛博朋克风格的护目镜，蹲在霓虹灯闪烁的雨夜街头，' +
  '背景是模糊的高楼与全息广告牌，湿润的路面反射着青色与品红色的光，' +
  '电影级光影，高细节，8k 画质，氛围感十足。';
