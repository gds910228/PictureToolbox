// cloud-secret.js — 统一腾讯云 API 密钥读取（云函数端）
//
// 本文件不含任何密钥值，可安全提交到 git。
// 每个云函数各持一份相同副本（微信云函数为隔离部署单元，无法跨目录 require）。
// canonical 源：cloudfunctionTemplate/cloud-secret.js
//
// 读取优先级：
//   1) 云函数环境变量（微信云开发控制台「云函数 → 环境变量」设置 —— 推荐方式）
//      统一变量名：TENCENTCLOUD_SECRET_ID / TENCENTCLOUD_SECRET_KEY / TENCENTCLOUD_REGION
//      向后兼容：SECRET_ID / SECRET_KEY / API_REGION
//   2) 本地调试回退：同目录下的 local-config.json（已被 .gitignore 忽略，仅本地调试用）
//
// 占位符（your_*、你的SecretId、_here、空值等）一律视为「未配置」，
// 避免拿占位符去鉴权导致签名错误。

const fs = require('fs');
const path = require('path');

const DEFAULT_REGION = 'ap-guangzhou';

// 占位符/无效值检测
function _isPlaceholder(v) {
  if (v == null) return true;
  const s = String(v).trim();
  if (!s) return true;
  return /your_|你的|替换|xxxx|example|placeholder|_here/i.test(s);
}

// 按候选键顺序读取第一个非占位符的环境变量
function _readEnv(keys) {
  for (let i = 0; i < keys.length; i++) {
    const v = process.env[keys[i]];
    if (!_isPlaceholder(v)) return v;
  }
  return '';
}

// 本地调试配置（local-config.json），读取一次后缓存
let _localCache; // undefined=未读, null=不存在, object=内容
function _readLocal() {
  if (_localCache !== undefined) return _localCache;
  _localCache = null;
  try {
    const p = path.join(__dirname, 'local-config.json');
    if (fs.existsSync(p)) {
      _localCache = JSON.parse(fs.readFileSync(p, 'utf8')) || null;
    }
  } catch (e) {
    console.warn('[cloud-secret] 读取 local-config.json 失败:', e.message);
  }
  return _localCache;
}

// 兼容 cloud.json 的 tencentCloud 嵌套结构
function _localField(field) {
  const c = _readLocal();
  if (!c) return '';
  if (!_isPlaceholder(c[field])) return c[field];
  if (c.tencentCloud && !_isPlaceholder(c.tencentCloud[field])) {
    return c.tencentCloud[field];
  }
  return '';
}

function getSecretId() {
  return _readEnv(['TENCENTCLOUD_SECRET_ID'])
    || _readEnv(['SECRET_ID'])
    || _localField('secretId');
}

function getSecretKey() {
  return _readEnv(['TENCENTCLOUD_SECRET_KEY'])
    || _readEnv(['SECRET_KEY'])
    || _localField('secretKey');
}

function getRegion() {
  return _readEnv(['TENCENTCLOUD_REGION'])
    || _readEnv(['API_REGION', 'REGION'])
    || _localField('region')
    || DEFAULT_REGION;
}

/**
 * 取得完整凭证信息
 * @returns {{secretId:string, secretKey:string, region:string, available:boolean}}
 */
function getCredentials() {
  const secretId = getSecretId();
  const secretKey = getSecretKey();
  return {
    secretId: secretId,
    secretKey: secretKey,
    region: getRegion(),
    available: !!secretId && !!secretKey
  };
}

/**
 * 断言密钥已配置；未配置则抛错（各 index.js 可在 try/catch 中走降级）
 */
function assertCredentials() {
  const cred = getCredentials();
  if (!cred.available) {
    throw new Error(
      '未配置腾讯云API密钥：请在微信云开发控制台为该云函数设置环境变量 ' +
      'TENCENTCLOUD_SECRET_ID / TENCENTCLOUD_SECRET_KEY'
    );
  }
  return cred;
}

module.exports = {
  getSecretId,
  getSecretKey,
  getRegion,
  getCredentials,
  assertCredentials
};
