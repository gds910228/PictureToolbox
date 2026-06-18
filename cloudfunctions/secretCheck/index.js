// cloudfunctions/secretCheck/index.js
// 安全检查云函数：返回密钥配置状态（绝不返回任何密钥值）。
// 供小程序 app.js 启动时调用；若密钥未配置，前端 console.warn 提示管理员。
const cloud = require('wx-server-sdk');
const secret = require('./cloud-secret');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

exports.main = async (event, context) => {
  const cred = secret.getCredentials();
  return {
    configured: cred.available,
    hasSecretId: !!cred.secretId,
    hasSecretKey: !!cred.secretKey,
    region: cred.region
  };
};
