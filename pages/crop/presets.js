// pages/crop/presets.js
// 图片裁剪的「比例」与「平台尺寸」预设配置。集中维护，新增平台只需在此追加。

// 通用比例预设：仅锁定宽高比，导出按裁剪原生尺寸（最长边封顶 MAX_EXPORT_EDGE）
const RATIO_PRESETS = [
  { id: '1:1',  name: '1:1',  ratio: 1,       desc: '正方形',  targetW: 0, targetH: 0 },
  { id: '4:3',  name: '4:3',  ratio: 4 / 3,   desc: '横版',    targetW: 0, targetH: 0 },
  { id: '16:9', name: '16:9', ratio: 16 / 9,  desc: '宽屏',    targetW: 0, targetH: 0 },
  { id: '9:16', name: '9:16', ratio: 9 / 16,  desc: '竖屏',    targetW: 0, targetH: 0 },
  { id: '3:4',  name: '3:4',  ratio: 3 / 4,   desc: '竖版',    targetW: 0, targetH: 0 },
  { id: 'free', name: '自由', ratio: 0,        desc: '任意',    targetW: 0, targetH: 0 }
];

// 平台预设：锁定比例 + 目标输出像素（导出时缩放到该尺寸，平台就绪）
const PLATFORM_PRESETS = [
  { id: 'xhs',     name: '小红书',   ratio: 3 / 4,  desc: '1080×1440', targetW: 1080, targetH: 1440 },
  { id: 'moments', name: '朋友圈',   ratio: 1,      desc: '1080×1080', targetW: 1080, targetH: 1080 },
  { id: 'douyin',  name: '抖音封面', ratio: 9 / 16, desc: '1080×1920', targetW: 1080, targetH: 1920 }
];

module.exports = { RATIO_PRESETS, PLATFORM_PRESETS };
