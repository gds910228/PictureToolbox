// cloudfunctions/aiStyleTransfer/index.js
// AI风格迁移云函数 - 使用混元大模型实现真实风格迁移

const cloud = require('wx-server-sdk');
const tencentcloud = require('tencentcloud-sdk-nodejs');

// 初始化云开发环境
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

/**
 * AI风格迁移
 * @param {event} Object - { fileID: string, style: string }
 * @returns {Object} - 风格迁移结果
 */
exports.main = async (event, context) => {
  const { fileID, style = 'oil-painting' } = event;

  console.log('开始AI风格迁移', { fileID, style });

  try {
    if (!fileID) {
      return {
        success: false,
        error: '缺少图片参数'
      };
    }

    // 从环境变量获取API密钥
    const secretId = process.env.SECRET_ID;
    const secretKey = process.env.SECRET_KEY;
    const region = process.env.API_REGION || 'ap-guangzhou';

    if (!secretId || !secretKey) {
      throw new Error('未配置腾讯云API密钥，请在云函数环境变量中配置 SECRET_ID 和 SECRET_KEY');
    }

    // 下载图片（用于后续可能的处理）
    const downloadResult = await cloud.downloadFile({
      fileID: fileID
    });

    const imageBuffer = downloadResult.fileContent;
    const base64Image = imageBuffer.toString('base64');
    console.log('下载图片成功，大小:', imageBuffer.length);

    // 调用混元文生图API进行风格迁移
    const styleResult = await callHunyuanStyleTransfer(base64Image, style, secretId, secretKey, region, fileID);

    if (!styleResult.success) {
      throw new Error(styleResult.error);
    }

    console.log('风格迁移完成');

    return {
      success: true,
      fileID: styleResult.fileID,
      style: style,
      styleName: styleResult.styleName
    };

  } catch (err) {
    console.error('AI风格迁移失败', err);
    return {
      success: false,
      error: err.message
    };
  }
};

/**
 * 调用腾讯云图像风格化API实现风格迁移
 * API文档：https://cloud.tencent.com/document/product/1668/88066
 */
async function callHunyuanStyleTransfer(base64Image, style, secretId, secretKey, region, originalFileID) {
  try {
    // 使用图像风格化服务（AIArt）
    const AiartClient = require('tencentcloud-sdk-nodejs').aiart.v20221229.Client;

    const client = new AiartClient({
      credential: {
        secretId: secretId,
        secretKey: secretKey,
      },
      region: region, // 图像风格化支持的地域：ap-guangzhou, ap-shanghai等
      profile: {
        signMethod: "TC3-HMAC-SHA256",
      }
    });

    console.log('使用图像风格化API生成风格化图片...');

    // 获取云存储URL（ImageToImage需要URL，不是base64）
    const urlResult = await cloud.getTempFileURL({
      fileList: [originalFileID]
    });

    const imageURL = urlResult.fileList[0].tempFileURL;
    console.log('获取图片URL:', imageURL);

    // 获取风格提示词
    const stylePrompt = getStylePrompt(style);

    // 获取风格编号（根据选择映射到预定义风格）
    const styleCode = getStyleCode(style);

    // 调用图像风格化API
    const params = {
      InputUrl: imageURL,
      Prompt: stylePrompt,
      Styles: [styleCode],
      RspImgType: "base64",
      LogoAdd: 0, // 不添加水印
      Strength: 0.5 // 降低到0.5，让风格转换更明显
    };

    console.log('发送图像风格化请求...');
    console.log('参数:', JSON.stringify(params, null, 2));

    const response = await client.ImageToImage(params);

    if (response && response.ResultImage) {
      const resultImageBase64 = response.ResultImage;

      // 转换为Buffer并上传
      const imageBuffer = Buffer.from(resultImageBase64, 'base64');

      const uploadResult = await cloud.uploadFile({
        cloudPath: `aiStyle/${Date.now()}_${style}.jpg`,
        fileContent: imageBuffer
      });

      console.log('风格迁移成功，已上传:', uploadResult.fileID);

      return {
        success: true,
        fileID: uploadResult.fileID,
        styleName: getStyleInfo(style).name
      };
    } else {
      throw new Error('API返回数据为空');
    }

  } catch (err) {
    console.error('图像风格化API调用失败:', err.message);
    console.error('错误详情:', JSON.stringify(err, null, 2));

    // 降级方案：返回错误说明
    return {
      success: false,
      error: `风格迁移失败: ${err.message}`
    };
  }
}

/**
 * 获取风格提示词
 */
function getStylePrompt(style) {
  const prompts = {
    'watercolor': '水彩画风格，透明质感，柔和色彩，流动的笔触，清新淡雅',
    'cartoon': '卡通插画风格，色彩鲜艳，线条流畅，可爱有趣',
    '3d-cartoon': '3D卡通风格，立体感强，圆润可爱，动画电影风格',
    'anime': '日系动漫风格，赛璐珞上色，精致线条，漫画风格',
    'ancient': '唯美古风风格，中国传统元素，古典优雅，诗意氛围',
    '2.5d': '2.5D动画风格，立体场景，层次分明，动画渲染',
    'wood-carving': '木雕风格，木质纹理，雕刻质感，传统工艺',
    'clay': '黏土风格，软泥质感，可爱好玩，手工制作感',
    'fresh-anime': '清新日漫风格，明快色彩，现代感，青春气息',
    'comic': '小人书插画风格，连环画风格，怀旧复古，手绘感',
    'gongbi': '国风工笔风格，工笔重彩，细腻精致，传统国画',
    'jade': '玉石风格，温润质感，光滑细腻，珠宝质感',
    'porcelain': '瓷器风格，光滑表面，精美纹饰，陶瓷质感',
    'felt-asia': '毛毡亚洲版风格，毛绒质感，亚洲风格，手工制作',
    'felt-west': '毛毡欧美版风格，毛绒质感，欧美风格，手工制作',
    'vintage-us': '美式复古风格，怀旧色彩，复古元素，美式风格',
    'steampunk': '蒸汽朋克风格，机械元素，维多利亚时代，工业感',
    'cyberpunk': '赛博朋克风格，霓虹灯光，未来科技感，暗黑都市',
    'sketch': '素描风格，铅笔线条，明暗对比，写实手绘',
    'monet': '莫奈花园风格，印象派，光影效果，浪漫主义',
    'impasto': '厚涂手绘风格，油画厚涂，笔触明显，质感强烈'
  };

  return prompts[style] || '艺术风格';
}

/**
 * 获取风格编号（映射到腾讯云图像风格化API的官方风格）
 * 官方风格列表：https://cloud.tencent.com/document/product/1668/86250
 */
function getStyleCode(style) {
  // 使用官方风格编号
  const styleCodes = {
    'watercolor': '104',        // 水彩画
    'cartoon': '107',           // 卡通插画
    '3d-cartoon': '116',        // 3D卡通
    'anime': '201',             // 日系动漫
    'ancient': '203',           // 唯美古风
    '2.5d': '210',              // 2.5D动画
    'wood-carving': '120',      // 木雕
    'clay': '121',              // 黏土
    'fresh-anime': '123',       // 清新日漫
    'comic': '124',             // 小人书插画
    'gongbi': '125',            // 国风工笔
    'jade': '126',              // 玉石
    'porcelain': '127',         // 瓷器
    'felt-asia': '135',         // 毛毡（亚洲版）
    'felt-west': '128',         // 毛毡（欧美版）
    'vintage-us': '129',        // 美式复古
    'steampunk': '130',         // 蒸汽朋克
    'cyberpunk': '131',         // 赛博朋克
    'sketch': '132',            // 素描
    'monet': '133',             // 莫奈花园
    'impasto': '134'            // 厚涂手绘
  };

  return styleCodes[style] || '201'; // 默认使用日系动漫风格
}

/**
 * 获取风格名称
 */
function getStyleInfo(style) {
  const styles = {
    'watercolor': { name: '水彩画' },
    'cartoon': { name: '卡通插画' },
    '3d-cartoon': { name: '3D卡通' },
    'anime': { name: '日系动漫' },
    'ancient': { name: '唯美古风' },
    '2.5d': { name: '2.5D动画' },
    'wood-carving': { name: '木雕' },
    'clay': { name: '黏土' },
    'fresh-anime': { name: '清新日漫' },
    'comic': { name: '小人书插画' },
    'gongbi': { name: '国风工笔' },
    'jade': { name: '玉石' },
    'porcelain': { name: '瓷器' },
    'felt-asia': { name: '毛毡(亚洲版)' },
    'felt-west': { name: '毛毡(欧美版)' },
    'vintage-us': { name: '美式复古' },
    'steampunk': { name: '蒸汽朋克' },
    'cyberpunk': { name: '赛博朋克' },
    'sketch': { name: '素描' },
    'monet': { name: '莫奈花园' },
    'impasto': { name: '厚涂手绘' }
  };

  return styles[style] || { name: '艺术风格' };
}
