// app.js
App({
  onLaunch() {
    console.log('图片工具箱启动');

    // 初始化云开发
    this.initCloud();

    // 检查更新
    this.checkUpdate();
  },

  /**
   * 初始化云开发环境
   */
  initCloud() {
    wx.cloud.init({
      env: 'cloud1-1gk79pjqd5e1ed35', // 请替换为你的云开发环境ID
      traceUser: true
    });
    console.log('云开发初始化完成');
  },

  onShow() {
    // 小程序显示时的逻辑
  },

  onHide() {
    // 小程序隐藏时的逻辑
  },

  /**
   * 检查小程序更新
   */
  checkUpdate() {
    if (wx.canIUse('getUpdateManager')) {
      const updateManager = wx.getUpdateManager();

      updateManager.onCheckForUpdate((res) => {
        if (res.hasUpdate) {
          updateManager.onUpdateReady(() => {
            wx.showModal({
              title: '更新提示',
              content: '新版本已经准备好，是否重启应用？',
              success: (res) => {
                if (res.confirm) {
                  updateManager.applyUpdate();
                }
              }
            });
          });

          updateManager.onUpdateFailed(() => {
            wx.showModal({
              title: '更新失败',
              content: '新版本下载失败，请检查网络后重试',
              showCancel: false
            });
          });
        }
      });
    }
  },

  /**
   * 全局数据
   */
  globalData: {
    userInfo: null,
    version: '1.0.0'
  }
});
