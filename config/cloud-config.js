/**
 * 云开发配置文件
 * 用于配置AI功能所需的云开发环境
 */

const cloudConfig = {
  // 是否启用云开发功能（包括AI分析）
  enabled: false,

  // 云环境ID（开通云开发后会自动生成）
  // 格式类似：cloud1-xxxxxxxx 或 xxx-xxxx-xxx
  envId: '',

  /**
   * 获取云环境ID
   * @returns {string} 云环境ID
   */
  getEnvId() {
    return this.envId;
  },

  /**
   * 检查云开发是否已配置
   * @returns {boolean} 是否已配置
   */
  isConfigured() {
    return this.enabled && this.envId && this.envId.length > 0;
  }
};

module.exports = cloudConfig;
