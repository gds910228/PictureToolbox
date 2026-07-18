// app.js
const analytics = require('./utils/analytics');

App({
  onLaunch() {
    // P0 埋点：注入启动场景码（各页 track() 自动带上 scene 来源）
    analytics.initScene();

    // 初始化云开发
    this.initCloud();

    // 安全检查：云函数密钥是否已配置（异常时 console.warn 提示管理员）
    this.checkSecretConfig();

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
   * 安全检查：调用 secretCheck 云函数探测密钥配置状态。
   * 前端不持有任何密钥，仅由云函数返回 configured 布尔值。
   */
  checkSecretConfig() {
    wx.cloud.callFunction({
      name: 'secretCheck',
      success: (res) => {
        const r = (res && res.result) || {};
        this.globalData.secretConfigured = !!r.configured;
        if (!r.configured) {
          console.warn('[安全检查] 云函数密钥未配置：AI 功能将降级。请在云开发控制台为云函数设置环境变量 TENCENTCLOUD_SECRET_ID / TENCENTCLOUD_SECRET_KEY', {
            hasSecretId: r.hasSecretId,
            hasSecretKey: r.hasSecretKey
          });
        }
      },
      fail: (err) => {
        // secretCheck 未部署 / 不可达时也提示（不影响主流程）
        this.globalData.secretConfigured = null;
        console.warn('[安全检查] 无法调用 secretCheck 云函数（可能未部署）：', err && err.errMsg);
      }
    });
  },

  /**
   * 全局数据
   */
  globalData: {
    userInfo: null,
    version: '1.0.0',
    secretConfigured: null // null=未知, true=已配置, false=未配置
  }
});
