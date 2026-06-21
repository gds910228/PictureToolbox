// cloudfunctions/aiEraser/index.js
// AI 智能去水印云函数 —— 三级降级策略
//   Level 1: Replicate LaMa 模型（高质量 inpainting）
//   Level 2: Hugging Face 免费 inpainting 推理
//   Level 3: 返回失败 → 前端本地 Canvas 模糊填充兜底
//
// 输入：{ fileID: string, maskBase64: string }
// 输出：{ success: boolean, fileID?: string, level?: number, degraded?: boolean, reason?: string }

const cloud = require('wx-server-sdk');
const axios = require('axios');
const secret = require('./cloud-secret');
const contentCheck = require('./content-check');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

// ============================================================
// 主入口
// ============================================================
exports.main = async (event, context) => {
  const { fileID, maskBase64 } = event;
  console.log('[aiEraser] 开始处理', { fileID, hasMask: !!maskBase64 });

  try {
    if (!fileID) {
      return { success: false, reason: '缺少图片参数 fileID', level: 0 };
    }
    if (!maskBase64) {
      return { success: false, reason: '缺少涂抹蒙版 maskBase64', level: 0 };
    }

    // 1. 下载原图
    const downloadResult = await cloud.downloadFile({ fileID });
    const imageBuffer = downloadResult.fileContent;
    console.log('[aiEraser] 下载图片成功，大小:', imageBuffer.length);

    // 2. 服务端内容安全兜底
    await contentCheck.assertImageSafe(imageBuffer, cloud);

    // 3. 解析 mask base64 → buffer
    const maskBuffer = Buffer.from(maskBase64.replace(/^data:image\/\w+;base64,/, ''), 'base64');
    console.log('[aiEraser] 蒙版大小:', maskBuffer.length);

    // 4. 三级降级依次尝试
    const creds = secret.getAllCredentials();

    // --- Level 1: Replicate LaMa ---
    if (creds.replicateAvailable) {
      console.log('[aiEraser] Level 1: 尝试 Replicate LaMa');
      try {
        const result = await callReplicateLaMa(imageBuffer, maskBuffer, creds.replicateToken);
        if (result && result.success) {
          const uploadResult = await cloud.uploadFile({
            cloudPath: `aiEraser/${Date.now()}.png`,
            fileContent: result.buffer
          });
          console.log('[aiEraser] Level 1 成功，fileID:', uploadResult.fileID);
          return {
            success: true,
            fileID: uploadResult.fileID,
            level: 1,
            degraded: false,
            engine: 'replicate-lama'
          };
        }
      } catch (e) {
        console.warn('[aiEraser] Level 1 失败:', e.message);
      }
    } else {
      console.log('[aiEraser] Level 1 跳过：未配置 REPLICATE_API_TOKEN');
    }

    // --- Level 2: Hugging Face Inpainting ---
    if (creds.hfAvailable) {
      console.log('[aiEraser] Level 2: 尝试 Hugging Face Inpainting');
      try {
        const result = await callHuggingFaceInpainting(imageBuffer, maskBuffer, creds.hfToken);
        if (result && result.success) {
          const uploadResult = await cloud.uploadFile({
            cloudPath: `aiEraser/${Date.now()}.png`,
            fileContent: result.buffer
          });
          console.log('[aiEraser] Level 2 成功，fileID:', uploadResult.fileID);
          return {
            success: true,
            fileID: uploadResult.fileID,
            level: 2,
            degraded: true,
            engine: 'huggingface-inpainting',
            reason: 'Replicate 不可用，已降级到 Hugging Face 推理'
          };
        }
      } catch (e) {
        console.warn('[aiEraser] Level 2 失败:', e.message);
      }
    } else {
      console.log('[aiEraser] Level 2 跳过：未配置 HF_API_TOKEN');
    }

    // --- Level 3: 返回失败，前端本地 Canvas 模糊填充兜底 ---
    console.log('[aiEraser] Level 3: 所有云端 API 不可用，返回降级提示');
    return {
      success: false,
      level: 3,
      degraded: true,
      reason: '云端 AI 服务暂不可用，已自动切换到本地模糊填充模式',
      engine: 'local-blur-fallback'
    };

  } catch (err) {
    console.error('[aiEraser] 整体失败:', err);
    return {
      success: false,
      level: 3,
      degraded: true,
      reason: '处理出错：' + (err.message || '未知错误') + '，已切换到本地模糊填充',
      engine: 'local-blur-fallback'
    };
  }
};

// ============================================================
// Level 1: Replicate LaMa
// ============================================================
// Replicate LaMa 模型：large_mask_inpainting 擅长大面积水印去除
// 模型配置通过环境变量 REPLICATE_MODELS（如 twn39/lama）和 REPLICATE_LAMA_VERSION 控制
async function callReplicateLaMa(imageBuffer, maskBuffer, token) {
  const imageBase64 = imageBuffer.toString('base64');
  const maskBase64 = maskBuffer.toString('base64');
  const models = secret.getReplicateModels();
  const version = secret.getReplicateLamaVersion();

  console.log('[aiEraser] Replicate 配置:', {
    models: models,
    hasVersion: !!version,
    versionLen: version ? version.length : 0
  });

  // 依次尝试每个模型
  let lastError = null;
  for (let m = 0; m < models.length; m++) {
    const modelName = models[m];
    console.log(`[aiEraser] 尝试 Replicate 模型 ${m+1}/${models.length}: ${modelName}`);

    try {
      const result = await callReplicateModel(modelName, version, imageBase64, maskBase64, token);
      if (result && result.success) {
        return result;
      }
    } catch (e) {
      lastError = e;
      console.warn(`[aiEraser] 模型 ${modelName} 失败: ${e.message}`);
    }
  }

  if (lastError) throw lastError;
  throw new Error('所有 Replicate 模型均调用失败');
}

/**
 * 调用单个 Replicate 模型
 * 优先使用 version hash（POST /v1/predictions）
 * 没有 version 则用模型名（POST /v1/models/{owner}/{name}/predictions）
 */
async function callReplicateModel(modelName, version, imageBase64, maskBase64, token) {
  let createUrl;
  let body;

  if (version && version.length > 20) {
    // 方式一：指定版本 hash
    createUrl = 'https://api.replicate.com/v1/predictions';
    body = {
      version: version,
      input: {
        image: `data:image/png;base64,${imageBase64}`,
        mask: `data:image/png;base64,${maskBase64}`
      }
    };
    console.log('[aiEraser] 使用版本号调用 Replicate API');
  } else {
    // 方式二：使用模型名（自动取最新版本）
    createUrl = `https://api.replicate.com/v1/models/${modelName}/predictions`;
    body = {
      input: {
        image: `data:image/png;base64,${imageBase64}`,
        mask: `data:image/png;base64,${maskBase64}`
      }
    };
    console.log('[aiEraser] 使用模型名调用 Replicate API:', modelName);
  }

  // 创建预测
  let createRes;
  try {
    createRes = await axios.post(createUrl, body, {
      headers: {
        'Authorization': `Token ${token}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });
  } catch (e) {
    // 打印详细错误信息，便于排查 422 等问题
    const respData = e.response && e.response.data;
    console.error('[aiEraser] Replicate 创建预测失败:', {
      status: e.response ? e.response.status : 'no_response',
      statusText: e.response ? e.response.statusText : '',
      data: respData ? JSON.stringify(respData).substring(0, 500) : 'no_data',
      url: createUrl,
      hasImage: !!imageBase64,
      hasMask: !!maskBase64,
      imageLen: imageBase64.length,
      maskLen: maskBase64.length
    });
    throw new Error(`Replicate API ${e.response ? e.response.status : 'network'} 错误: ${
      respData && respData.detail ? respData.detail :
      respData && respData.error ? respData.error :
      e.message
    }`);
  }

  const predictionId = createRes.data.id;
  if (!predictionId) {
    console.error('[aiEraser] Replicate 返回无 id:', JSON.stringify(createRes.data));
    throw new Error('Replicate 创建预测失败：返回无 id');
  }
  console.log('[aiEraser] Replicate 预测已创建:', predictionId, 'status:', createRes.data.status);

  // 轮询等待结果（最长 120 秒，避免云函数超时）
  const maxWait = 110000;
  const interval = 3000;
  let waited = 0;

  while (waited < maxWait) {
    await new Promise(r => setTimeout(r, interval));
    waited += interval;

    const pollRes = await axios.get(
      `https://api.replicate.com/v1/predictions/${predictionId}`,
      {
        headers: { 'Authorization': `Token ${token}` },
        timeout: 15000
      }
    );

    const status = pollRes.data.status;
    console.log(`[aiEraser] Replicate 轮询 (${Math.round(waited/1000)}s): ${status}`);

    if (status === 'succeeded') {
      const output = pollRes.data.output;
      let outputUrl;
      // output 可能是字符串 URL，也可能是数组
      if (typeof output === 'string') {
        outputUrl = output;
      } else if (Array.isArray(output) && output.length > 0) {
        outputUrl = output[output.length - 1];
      } else if (output && typeof output === 'object') {
        // 某些模型返回对象
        outputUrl = output.url || output.output || Object.values(output)[0];
      }

      if (!outputUrl) {
        console.error('[aiEraser] Replicate 输出格式未知:', typeof output, JSON.stringify(output).substring(0, 200));
        throw new Error('Replicate 输出格式无法解析');
      }

      console.log('[aiEraser] Replicate 成功，下载结果...');
      const imgRes = await axios.get(outputUrl, {
        responseType: 'arraybuffer',
        timeout: 30000
      });
      return { success: true, buffer: Buffer.from(imgRes.data) };
    }

    if (status === 'failed' || status === 'canceled') {
      const errMsg = pollRes.data.error || status;
      console.error('[aiEraser] Replicate 预测失败:', errMsg);
      throw new Error('Replicate 预测失败：' + errMsg);
    }
  }

  throw new Error('Replicate 处理超时（>110s）');
}

// ============================================================
// Level 2: Hugging Face Inference API
// ============================================================
// 使用 HF 的 inpainting 模型（免费层有限速）
// 模型：runwayml/stable-diffusion-inpainting
async function callHuggingFaceInpainting(imageBuffer, maskBuffer, token) {
  const imageBase64 = imageBuffer.toString('base64');
  const maskBase64 = maskBuffer.toString('base64');

  const modelUrl = 'https://api-inference.huggingface.co/models/runwayml/stable-diffusion-inpainting';

  const response = await axios.post(
    modelUrl,
    {
      inputs: {
        image: `data:image/png;base64,${imageBase64}`,
        mask_image: `data:image/png;base64,${maskBase64}`,
        prompt: "clean background, remove watermark, high quality"
      }
    },
    {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'x-wait-for-model': 'true'
      },
      timeout: 60000,
      responseType: 'arraybuffer'
    }
  );

  if (response.status === 200 && response.data && response.data.length > 0) {
    // HF 返回二进制图片数据
    return { success: true, buffer: Buffer.from(response.data) };
  }

  throw new Error('HF Inpainting 返回异常：status=' + response.status);
}
