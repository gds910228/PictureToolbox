// pages/index/index.js

const analytics = require('../../utils/analytics');

// NEW 标签依据：上线日期距今 < NEW_WINDOW_DAYS 才显示，到期自动摘标。
// 新增功能只需在 LAUNCH_DATES 填上线日期（YYYY-MM-DD），无需手动清理 isNew。
// 未登记的功能默认不挂 NEW。
const NEW_WINDOW_DAYS = 14;
const LAUNCH_DATES = {
  aiMatting: '2026-03-04',
  aiStyle: '2026-03-05',
  aiOCR: '2026-06-17',
  aiEraser: '2026-06-21',
  imgToPdf: '2026-06-20',
  exif: '2026-06-20',
  aiUpscale: '2026-07-03',
  aiColorize: '2026-07-03',
  aiChat: '2026-07-03',
  aiCaption: '2026-07-03',
  aiDescribe: '2026-07-06',
  similarity: '2026-07-03',
  makeGif: '2026-07-03',
  colorAnalysis: '2026-07-03',
  formatRecommend: '2026-07-03',
  idPhoto: '2026-07-06',
  hiddenWatermark: '2026-07-06',
  aiOutpaint: '2026-07-06',
  aiTextToImage: '2026-07-07',
  aiAvatar: '2026-07-07',
  pdfToImage: '2026-07-07'
};

function isToolNew(toolId) {
  const launch = LAUNCH_DATES[toolId];
  if (!launch) return false;
  const days = (Date.now() - new Date(launch).getTime()) / 86400000;
  return days < NEW_WINDOW_DAYS;
}

Page({
  data: {
    // 顶部 Banner 打字机轮播的工具名
    bannerTools: [
      { id: 'aiChat', name: '图片问答' },
      { id: 'aiMatting', name: '一键抠图' },
      { id: 'aiEraser', name: '去水印' },
      { id: 'aiStyle', name: '风格迁移' },
      { id: 'aiUpscale', name: 'AI放大' },
      { id: 'aiColorize', name: '老照片上色' },
      { id: 'aiOCR', name: '文字识别' },
      { id: 'aiTextToImage', name: 'AI 文生图' },
      { id: 'aiAvatar', name: 'AI 百变头像' }
    ],
    typedName: '',
    currentToolIdx: 0,
    // 热门场景直达（高频搜索词既是入口又强化首页主题相关性）
    hotScenes: [
      { id: 'matting', name: '抠图换背景', icon: '✂️', url: '/pages/aiMatting/aiMatting' },
      { id: 'eraser', name: '去水印/消除', icon: '🩹', url: '/pages/aiEraser/aiEraser' },
      { id: 'idphoto', name: '证件照制作', icon: '🪪', url: '/pages/idPhoto/idPhoto' },
      { id: 'colorize', name: '老照片上色', icon: '🌈', url: '/pages/aiColorize/aiColorize' },
      { id: 'pdf2img', name: 'PDF转图片', icon: '📄', url: '/pages/pdfToImage/pdfToImage' },
      { id: 't2i', name: 'AI 画画', icon: '🎨', url: '/pages/aiTextToImage/aiTextToImage' }
    ],
    // 分组
    groups: [
      {
        key: 'ai',
        title: 'AI 智能',
        subtitle: '前沿 AI 能力加持',
        expanded: true,
        tools: [
          {
            id: 'aiMatting',
            name: '智能抠图',
            desc: '智能抠图，一键去除背景',
            url: '/pages/aiMatting/aiMatting',
            available: true,
            isNew: true
          },
          {
            id: 'aiEraser',
            name: '去水印',
            desc: '涂抹水印区域，AI智能修复去除',
            url: '/pages/aiEraser/aiEraser',
            available: true,
            isNew: true
          },
          {
            id: 'idPhoto',
            name: '证件照制作',
            desc: 'AI抠图换底 + 人脸定位自动校正，多规格多底色',
            url: '/pages/idPhoto/idPhoto',
            available: true,
            isNew: true
          },
          {
            id: 'aiAvatar',
            name: 'AI 百变头像',
            desc: '15种风格头像/萌宠贴纸，一键生成',
            url: '/pages/aiAvatar/aiAvatar',
            available: true,
            isNew: true
          },
          {
            id: 'aiColorize',
            name: '老照片上色',
            desc: '黑白老照片智能上色，自然/复古风格',
            url: '/pages/aiColorize/aiColorize',
            available: true,
            isNew: true
          },
          {
            id: 'aiOCR',
            name: '文字识别',
            desc: '高精度OCR识别图片中的文字',
            url: '/pages/aiOCR/aiOCR',
            available: true,
            isNew: true
          },
          {
            id: 'aiCaption',
            name: '智能配文',
            desc: '一键生成朋友圈、小红书等社媒配文',
            url: '/pages/aiCaption/aiCaption',
            available: true,
            isNew: true
          },
          {
            id: 'aiUpscale',
            name: '图片放大',
            desc: '2x/4x超分辨率放大，可选降噪锐化',
            url: '/pages/aiUpscale/aiUpscale',
            available: true,
            isNew: true
          },
          {
            id: 'aiTextToImage',
            name: 'AI 文生图',
            desc: '腾讯混元3.0文生图，AI帮写提示词',
            url: '/pages/aiTextToImage/aiTextToImage',
            available: true,
            isNew: true
          },
          {
            id: 'aiChat',
            name: '图片问答',
            desc: '上传图片自由提问，多轮对话追问细节',
            url: '/pages/aiChat/aiChat',
            available: true,
            isNew: true
          },
          {
            id: 'aiOutpaint',
            name: 'AI 扩图',
            desc: '按比例智能扩展画面，补全背景',
            url: '/pages/aiOutpaint/aiOutpaint',
            available: true,
            isNew: true
          },
          {
            id: 'aiDescribe',
            name: '图片描述',
            desc: '7种风格智能描述图片，看懂画面内容',
            url: '/pages/aiDescribe/aiDescribe',
            available: true,
            isNew: true
          }
        ]
      },
      {
        key: 'basic',
        title: '基础处理',
        subtitle: '日常图片处理必备',
        expanded: true,
        tools: [
          {
            id: 'compress',
            name: '图片压缩',
            desc: '智能压缩图片，保持画质的同时减小文件大小',
            url: '/pages/compress/compress',
            available: true,
            isNew: false
          },
          {
            id: 'watermark',
            name: '图片水印',
            desc: '添加文字水印，AI智能生成文案',
            url: '/pages/watermark/watermark',
            available: true,
            isNew: false
          },
          {
            id: 'imgToPdf',
            name: '多图合PDF',
            desc: '多图按名称排序合成PDF，支持A4/16:9/1:1',
            url: '/pages/imgToPdf/imgToPdf',
            available: true,
            isNew: true
          },
          {
            id: 'pdfToImage',
            name: 'PDF转图片',
            desc: 'PDF逐页导出为PNG/JPG高清图片',
            url: '/pages/pdfToImage/pdfToImage',
            available: true,
            isNew: true
          },
          {
            id: 'splice',
            name: '图片拼接',
            desc: '智能拼接，AI推荐布局',
            url: '/pages/splice/splice',
            available: true,
            isNew: false
          },
          {
            id: 'crop',
            name: '图片裁剪',
            desc: '支持多种常用比例裁剪，也可自定义任意比例',
            url: '/pages/crop/crop',
            available: true,
            isNew: false
          },
          {
            id: 'convert',
            name: '格式转换',
            desc: '支持JPG、PNG、WebP等主流格式互转',
            url: '/pages/convert/convert',
            available: true,
            isNew: false
          },
          {
            id: 'exif',
            name: 'EXIF信息',
            desc: '查看图片元数据，一键抹除GPS等隐私信息',
            url: '/pages/exif/exif',
            available: true,
            isNew: true
          },
          {
            id: 'similarity',
            name: '找重复图',
            desc: '双图相似度对比，多图批量查重',
            url: '/pages/similarity/similarity',
            available: true,
            isNew: true
          },
          {
            id: 'formatRecommend',
            name: '格式推荐',
            desc: '分析图片特征，推荐最优格式与压缩参数',
            url: '/pages/formatRecommend/formatRecommend',
            available: true,
            isNew: true
          },
          {
            id: 'colorAnalysis',
            name: '颜色分析',
            desc: '提取图片主色调，生成色卡并导出HEX/RGB/HSL',
            url: '/pages/colorAnalysis/colorAnalysis',
            available: true,
            isNew: true
          }
        ]
      },
      {
        key: 'creative',
        title: '创意玩法',
        subtitle: '让图片更有趣',
        expanded: true,
        tools: [
          {
            id: 'makeGif',
            name: 'GIF制作',
            desc: '多图合成动图，本地生成无需联网',
            url: '/pages/makeGif/makeGif',
            available: true,
            isNew: true
          },
          {
            id: 'filter',
            name: '图片滤镜',
            desc: '多种滤镜效果，实时预览',
            url: '/pages/filter/filter',
            available: true,
            isNew: false
          },
          {
            id: 'aiStyle',
            name: '风格迁移',
            desc: '将照片转换为艺术风格',
            url: '/pages/aiStyle/aiStyle',
            available: true,
            isNew: true
          },
          {
            id: 'hiddenWatermark',
            name: '隐形水印',
            desc: '文字隐形嵌入图片像素，可密钥提取还原',
            url: '/pages/hiddenWatermark/hiddenWatermark',
            available: true,
            isNew: true
          }
        ]
      }
    ]
  },

  onLoad() {

    // P0 埋点：首页访问 + 来源场景
    analytics.track('tool_view', { toolId: 'index' });
    analytics.track('enter_source', { scene: analytics.getScene() });

    // 将每个工具的 available 转换为布尔值
    const groups = this.data.groups.map(group => ({
      ...group,
      tools: group.tools.map(tool => ({
        ...tool,
        available: Boolean(tool.available),
        isNew: isToolNew(tool.id)
      }))
    }));

    this.setData({ groups });

    // 启动打字机效果
    this._startTypewriter();

    // 首页安全检查：若云函数密钥未配置，console.warn 提示管理员
    setTimeout(() => {
      const app = getApp();
      if (app && app.globalData && app.globalData.secretConfigured === false) {
        console.warn('[首页安全检查] 检测到云函数密钥未配置，AI 功能将降级。详见 app.js 启动日志。');
      }
    }, 3000);
  },

  onUnload() {
    this._stopTypewriter();
  },

  onHide() {
    this._stopTypewriter();
  },

  onShow() {
    // 若打字机定时器被清空，重新启动
    if (!this._typeTimer) {
      this._startTypewriter();
    }
  },

  /**
   * 打字机效果：逐字显示 bannerTools 中的工具名，循环切换
   */
  _startTypewriter() {
    if (this._typeTimer) return;

    const tools = this.data.bannerTools;
    let toolIdx = 0;
    let charIdx = 0;
    let phase = 'typing'; // typing | pausing | erasing

    const tick = () => {
      const current = tools[toolIdx];
      if (!current) return;

      if (phase === 'typing') {
        charIdx += 1;
        this.setData({
          typedName: current.name.slice(0, charIdx),
          currentToolIdx: toolIdx
        });
        if (charIdx >= current.name.length) {
          phase = 'pausing';
          this._typeTimer = setTimeout(tick, 1800);
          return;
        }
        this._typeTimer = setTimeout(tick, 120);
      } else if (phase === 'pausing') {
        phase = 'erasing';
        tick();
      } else if (phase === 'erasing') {
        charIdx -= 1;
        if (charIdx <= 0) {
          charIdx = 0;
          this.setData({ typedName: '' });
          toolIdx = (toolIdx + 1) % tools.length;
          phase = 'typing';
          this._typeTimer = setTimeout(tick, 200);
          return;
        }
        this.setData({ typedName: current.name.slice(0, charIdx) });
        this._typeTimer = setTimeout(tick, 60);
      }
    };

    tick();
  },

  _stopTypewriter() {
    if (this._typeTimer) {
      clearTimeout(this._typeTimer);
      this._typeTimer = null;
    }
  },

  /**
   * 折叠 / 展开分组
   */
  onToggleGroup(e) {
    const { key } = e.currentTarget.dataset;
    const groups = this.data.groups.map(g => ({
      ...g,
      expanded: g.key === key ? !g.expanded : g.expanded
    }));
    this.setData({ groups });
  },

  /**
   * 点击工具卡片
   */
  onToolTap(e) {
    const { available } = e.currentTarget.dataset;

    const isAvailable = available === 'true' || available === true;

    // available=false 时 <navigator url> 为空串不会跳转，这里只负责拦截提示；
    // available=true 时跳转交由 <navigator url> 处理（便于搜索爬虫发现页面 URL）。
    if (!isAvailable) {
      wx.showToast({
        title: '功能开发中',
        icon: 'none',
        duration: 2000
      });
      return;
    }
  },

  /**
   * 点击热门场景卡片直达
   */
  onSceneTap(e) {
    const { url } = e.currentTarget.dataset;
    if (!url) return;
    analytics.track('hot_scene_click', { url });
    // 跳转交由 <navigator url> 处理（便于搜索爬虫发现页面 URL）。
  },

  /**
   * 分享功能
   */
  onShareAppMessage() {
    analytics.trackShare('index', 'friend');
    return {
      title: '免费抠图/去水印/证件照/文生图，25+图片工具一次搞定',
      path: '/pages/index/index',
      imageUrl: ''
    };
  },

  /**
   * 分享到朋友圈
   */
  onShareTimeline() {
    analytics.trackShare('index', 'timeline');
    return {
      title: '免费抠图/去水印/证件照/文生图，25+图片工具一次搞定',
      imageUrl: ''
    };
  }
});