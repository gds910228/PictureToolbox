// cloudfunctions/makeGif/index.js
//
// 【增强位 · 暂未启用】
// GIF 制作 MVP 全程在前端本地完成（pages/makeGif + utils/gif-encoder），
// 不依赖云函数。此目录为"超限任务增强位"预留：
//   当出现客户端无法承担的场景（如超大尺寸/超多帧的服务端编码、云端转码、
//   批量任务队列）时，在此实现服务端编码并下发结果。
//
// 当前实现仅返回占位提示，不被前端调用。

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event) => {
  // TODO: 服务端 GIF 编码增强（按需引入服务端编码能力）
  return {
    ok: false,
    code: 'NOT_IMPLEMENTED',
    message: 'GIF 制作为前端本地能力，云函数增强位暂未启用。'
  };
};
