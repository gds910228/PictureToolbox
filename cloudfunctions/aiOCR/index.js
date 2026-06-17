// cloudfunctions/aiOCR/index.js
// AI文字识别云函数 - 腾讯云通用印刷体OCR

const cloud = require('wx-server-sdk');
const tencentcloud = require('tencentcloud-sdk-nodejs');

// 导入OCR产品模块
const OcrClient = tencentcloud.ocr.v20181119.Client;

// 初始化云开发环境
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

/**
 * AI文字识别主函数
 * @param {event} Object - { fileID: string, base64Image: string }
 * @returns {Object} - OCR识别结果
 */
exports.main = async (event, context) => {
  const { fileID, base64Image } = event;

  console.log('开始AI文字识别', { fileID, hasBase64: !!base64Image });

  try {
    // 获取图片base64数据
    let imageBase64 = '';
    let imageWidth = 0;
    let imageHeight = 0;

    if (fileID) {
      // 从云存储下载图片
      const fileRes = await cloud.downloadFile({
        fileID: fileID
      });
      console.log('图片下载成功，大小:', fileRes.fileContent.length, 'bytes');

      // 转base64
      imageBase64 = fileRes.fileContent.toString('base64');

      // 尝试获取图片尺寸（简单方式：用Buffer读取头信息）
      const dims = getImageDimensions(fileRes.fileContent);
      imageWidth = dims.width;
      imageHeight = dims.height;
      console.log('图片尺寸:', imageWidth, 'x', imageHeight);

    } else if (base64Image) {
      // 直接使用传入的base64
      imageBase64 = base64Image.replace(/^data:image\/\w+;base64,/, '');
      const buf = Buffer.from(imageBase64, 'base64');
      const dims = getImageDimensions(buf);
      imageWidth = dims.width;
      imageHeight = dims.height;
    } else {
      return {
        success: false,
        error: '缺少图片参数'
      };
    }

    // 调用OCR API
    console.log('调用腾讯云OCR API...');
    const ocrResult = await callOCRApi(imageBase64);

    console.log('OCR识别完成，共', ocrResult.textDetections.length, '行文字');

    return {
      success: true,
      textDetections: ocrResult.textDetections,
      fullText: ocrResult.fullText,
      imageWidth: imageWidth,
      imageHeight: imageHeight,
      language: ocrResult.language || 'zh',
      isMock: ocrResult.isMock || false
    };

  } catch (err) {
    console.error('OCR识别失败', err);
    return {
      success: false,
      error: err.message || '识别失败'
    };
  }
};

/**
 * 调用腾讯云通用印刷体OCR API
 */
async function callOCRApi(imageBase64) {
  // 从环境变量获取API密钥（支持多种命名）
  const secretId = process.env.TENCENTCLOUD_SECRET_ID || process.env.SECRET_ID;
  const secretKey = process.env.TENCENTCLOUD_SECRET_KEY || process.env.SECRET_KEY;
  const region = process.env.TENCENTCLOUD_REGION || process.env.API_REGION || 'ap-guangzhou';

  console.log('环境变量检查:', {
    hasSecretId: !!secretId,
    hasSecretKey: !!secretKey,
    secretIdPrefix: secretId ? secretId.substring(0, 8) : 'null',
    region: region
  });

  // 检查是否配置了API密钥
  if (!secretId || !secretKey) {
    console.log('未配置API密钥，使用模拟实现');
    return mockOCRResult();
  }

  // 检查是否使用占位符
  if (secretId === '' || secretKey === '' ||
      secretId.includes('your_') || secretKey.includes('your_') ||
      secretId.includes('你的') || secretKey.includes('你的')) {
    console.log('使用占位符密钥，使用模拟实现');
    return mockOCRResult();
  }

  try {
    // 实例化OCR客户端
    const client = new OcrClient({
      credential: {
        secretId: secretId,
        secretKey: secretKey,
      },
      region: region,
      profile: {
        signMethod: "TC3-HMAC-SHA256",
      }
    });

    // 构建请求参数 - 通用印刷体识别（高精度版）
    const params = {
      ImageBase64: imageBase64,
      IsWords: true,            // 返回单字信息
      EnableDetectSplit: true,  // 开启分段检测
      IsPdf: false,
      PdfPageNumber: 1,
      ConfigID: 'OCR',          // 通用场景
    };

    // 调用API
    const response = await client.GeneralAccurateOCR(params);

    console.log('OCR API返回状态:', response.RequestId ? '成功' : '未知');

    // 解析返回结果
    const result = response.Response || response;
    const textDetections = result.TextDetections || [];

    // 转换为统一格式
    const detections = textDetections.map((item, index) => {
      // 腾讯云返回的坐标格式：多边形四个点 + 置信度 + 文字
      const polygon = item.Polygon || [];
      const coords = polygon.map(p => ({
        x: p.X || 0,
        y: p.Y || 0
      }));

      // 计算边界框
      let minX = Infinity, minY = Infinity, maxX = 0, maxY = 0;
      coords.forEach(c => {
        if (c.x < minX) minX = c.x;
        if (c.y < minY) minY = c.y;
        if (c.x > maxX) maxX = c.x;
        if (c.y > maxY) maxY = c.y;
      });

      return {
        index: index,
        text: item.DetectedText || '',
        confidence: item.Confidence || 0,
        polygon: coords,
        bbox: {
          x: minX,
          y: minY,
          width: maxX - minX,
          height: maxY - minY
        },
        // 单字信息（如果有）
        words: item.Words || [],
        advancedInfo: item.AdvancedInfo || ''
      };
    });

    // 拼接完整文字
    const fullText = detections.map(d => d.text).join('\n');

    return {
      textDetections: detections,
      fullText: fullText,
      language: 'mixed'
    };

  } catch (err) {
    console.error('调用OCR API失败:', err);
    // API调用失败时，返回模拟结果
    console.log('API调用失败，使用模拟实现');
    return mockOCRResult();
  }
}

/**
 * 模拟OCR结果（当API未配置或调用失败时使用）
 */
function mockOCRResult() {
  const mockDetections = [
    {
      index: 0,
      text: 'AI文字识别',
      confidence: 99,
      polygon: [
        { x: 50, y: 40 }, { x: 280, y: 40 },
        { x: 280, y: 90 }, { x: 50, y: 90 }
      ],
      bbox: { x: 50, y: 40, width: 230, height: 50 },
      words: [],
      advancedInfo: ''
    },
    {
      index: 1,
      text: 'OCR文字识别示例文档',
      confidence: 98,
      polygon: [
        { x: 50, y: 110 }, { x: 400, y: 110 },
        { x: 400, y: 150 }, { x: 50, y: 150 }
      ],
      bbox: { x: 50, y: 110, width: 350, height: 40 },
      words: [],
      advancedInfo: ''
    },
    {
      index: 2,
      text: '支持中英文数字混合识别',
      confidence: 97,
      polygon: [
        { x: 50, y: 180 }, { x: 420, y: 180 },
        { x: 420, y: 215 }, { x: 50, y: 215 }
      ],
      bbox: { x: 50, y: 180, width: 370, height: 35 },
      words: [],
      advancedInfo: ''
    },
    {
      index: 3,
      text: 'Hello World 12345',
      confidence: 96,
      polygon: [
        { x: 50, y: 245 }, { x: 320, y: 245 },
        { x: 320, y: 280 }, { x: 50, y: 280 }
      ],
      bbox: { x: 50, y: 245, width: 270, height: 35 },
      words: [],
      advancedInfo: ''
    },
    {
      index: 4,
      text: '腾讯云OCR每月免费1000次',
      confidence: 95,
      polygon: [
        { x: 50, y: 310 }, { x: 450, y: 310 },
        { x: 450, y: 345 }, { x: 50, y: 345 }
      ],
      bbox: { x: 50, y: 310, width: 400, height: 35 },
      words: [],
      advancedInfo: ''
    },
    {
      index: 5,
      text: '高精度印刷体识别准确率99%+',
      confidence: 94,
      polygon: [
        { x: 50, y: 375 }, { x: 480, y: 375 },
        { x: 480, y: 410 }, { x: 50, y: 410 }
      ],
      bbox: { x: 50, y: 375, width: 430, height: 35 },
      words: [],
      advancedInfo: ''
    }
  ];

  const fullText = mockDetections.map(d => d.text).join('\n');

  return {
    textDetections: mockDetections,
    fullText: fullText,
    language: 'mixed',
    isMock: true
  };
}

/**
 * 获取图片尺寸（支持JPG/PNG简单头解析）
 */
function getImageDimensions(buffer) {
  // 默认尺寸
  let width = 800;
  let height = 600;

  try {
    // PNG: 8字节签名后是IHDR chunk，包含宽高(各4字节大端)
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
      width = buffer.readUInt32BE(16);
      height = buffer.readUInt32BE(20);
    }
    // JPEG: 扫描SOF标记
    else if (buffer[0] === 0xFF && buffer[1] === 0xD8) {
      let offset = 2;
      while (offset < buffer.length - 1) {
        if (buffer[offset] === 0xFF) {
          const marker = buffer[offset + 1];
          // SOF0 - SOF15 (除DHT=0xC4, DAC=0xCC, DNL=0xDC, DRI=0xDD, RSTn=0xD0-0xD7, SOI=0xD8, EOI=0xD9)
          if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xCC && marker !== 0xCD) {
            height = buffer.readUInt16BE(offset + 5);
            width = buffer.readUInt16BE(offset + 7);
            break;
          }
          // 跳过该段
          const segLen = buffer.readUInt16BE(offset + 2);
          offset += 2 + segLen;
        } else {
          offset++;
        }
      }
    }
    // GIF
    else if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
      width = buffer.readUInt16LE(6);
      height = buffer.readUInt16LE(8);
    }
    // BMP
    else if (buffer[0] === 0x42 && buffer[1] === 0x4D) {
      width = buffer.readInt32LE(18);
      height = Math.abs(buffer.readInt32LE(22));
    }
  } catch (e) {
    console.warn('解析图片尺寸失败，使用默认值', e.message);
  }

  return { width, height };
}
