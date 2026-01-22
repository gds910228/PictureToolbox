// pages/index/index.js
Page({
  data: {
    tools: [
      {
        id: 'compress',
        name: '图片压缩',
        icon: '🗜️',
        desc: '智能压缩图片，保持画质的同时减小文件大小',
        url: '/pages/compress/compress',
        available: true
      },
      {
        id: 'crop',
        name: '图片裁剪',
        icon: '✂️',
        desc: '支持多种常用比例裁剪，也可自定义任意比例',
        url: '/pages/crop/crop',
        available: true
      },
      {
        id: 'convert',
        name: '格式转换',
        icon: '🔄',
        desc: '支持JPG、PNG、WebP等主流格式互转',
        url: '/pages/convert/convert',
        available: true
      },
      {
        id: 'watermark',
        name: '图片水印',
        icon: '💧',
        desc: '添加文字水印，AI智能生成文案',
        url: '/pages/watermark/watermark',
        available: true
      },
      {
        id: 'filter',
        name: '图片滤镜',
        icon: '🎨',
        desc: '多种滤镜效果，AI风格迁移',
        url: '/pages/filter/filter',
        available: true
      },
      {
        id: 'splice',
        name: '图片拼接',
        icon: '🔗',
        desc: '智能拼接，AI推荐布局',
        url: '/pages/splice/splice',
        available: true
      }
    ]
  },

  onLoad() {
    wx.setNavigationBarTitle({
      title: '图片工具箱'
    });

    // 调试：打印工具列表
    console.log('工具列表数据:', this.data.tools);
    console.log('可用工具数量:', this.data.tools.filter(t => t.available).length);
    console.log('第一个工具的 available 类型:', typeof this.data.tools[0].available);
    console.log('第一个工具的 available 值:', this.data.tools[0].available);

    // 将每个工具的 available 转换为布尔值
    const tools = this.data.tools.map(tool => {
      return {
        id: tool.id,
        name: tool.name,
        icon: tool.icon,
        desc: tool.desc,
        url: tool.url,
        available: Boolean(tool.available)
      };
    });

    console.log('转换后的工具列表:', tools);

    this.setData({
      tools: tools
    });
  },

  onShow() {
    // 页面显示时的逻辑
  },

  /**
   * 点击工具卡片
   */
  onToolTap(e) {
    const { id, name, url, available } = e.currentTarget.dataset;
    console.log('点击工具 - ID:', id, '名称:', name, '可用:', available, '类型:', typeof available);

    // available 从 dataset 传递过来时是字符串，需要转换
    const isAvailable = available === 'true' || available === true;

    if (!isAvailable) {
      wx.showToast({
        title: '功能开发中',
        icon: 'none',
        duration: 2000
      });
      return;
    }

    wx.navigateTo({
      url: url
    });
  },

  /**
   * 分享功能
   */
  onShareAppMessage() {
    return {
      title: '图片工具箱 - 简单高效的图片处理工具',
      path: '/pages/index/index',
      imageUrl: ''
    };
  },

  /**
   * 分享到朋友圈
   */
  onShareTimeline() {
    return {
      title: '图片工具箱 - 简单高效的图片处理工具',
      imageUrl: ''
    };
  }
});
