// cloud-secret.js — 统一 API 密钥读取（云函数端），aiColorize 专用
// 本文件不含任何密钥值，可安全提交到 git。
// canonical 源：cloudfunctionTemplate/cloud-secret.js（此处为 aiColorize 副本，增加 DeOldify 取证）
//
// 读取优先级：
//   1) 云函数环境变量（微信云开发控制台「云函数 → 环境变量」设置）
//   2) 本地调试回退：同目录下的 local-config.json（.gitignore 忽略）
//
// 占位符（your_*、_here、空值等）一律视为「未配置」。

const fs = require('fs');
const path = require('path');

const DEFAULT_REGION = 'ap-guangzhou';

function _isPlaceholder(v) {
  if (v == null) return true;
  const s = String(v).trim();
  if (!s) return true;
  return /your_|你的|替换|xxxx|example|placeholder|_here/i.test(s);
}

function _readEnv(keys) {
  for (let i = 0; i < keys.length; i++) {
    const v = process.env[keys[i]];
    if (!_isPlaceholder(v)) return v;
  }
  return '';
}

let _localCache;
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

function _localField(field) {
  const c = _readLocal();
  if (!c) return '';
  if (!_isPlaceholder(c[field])) return c[field];
  return '';
}

// Replicate API Token
function getReplicateToken() {
  return _readEnv(['REPLICATE_API_TOKEN', 'REPLICATE_TOKEN'])
    || _localField('replicateToken');
}

// Replicate 上色模型名（如 arielreplicate/deoldify_image），支持逗号分隔多个（按顺序尝试）
function getReplicateColorizeModels() {
  const val = _readEnv(['REPLICATE_COLORIZE_MODELS', 'REPLICATE_DEOLDIFY_MODELS', 'REPLICATE_DEOLDIFY_MODEL'])
    || _localField('replicateColorizeModels')
    || 'arielreplicate/deoldify_image';
  return val.split(',').map(s => s.trim()).filter(Boolean);
}

// Replicate 上色模型版本 hash（可选；不填则用模型最新版本，走 /models/{owner}/{name}/predictions）
function getReplicateColorizeVersion() {
  return _readEnv(['REPLICATE_COLORIZE_VERSION', 'REPLICATE_DEOLDIFY_VERSION'])
    || _localField('replicateColorizeVersion');
}

// 腾讯云密钥（内容安全检测用，本函数实际走 openapi，这里保留以便一致性）
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

function getAllCredentials() {
  return {
    replicateToken: getReplicateToken(),
    replicateColorizeModels: getReplicateColorizeModels(),
    replicateColorizeVersion: getReplicateColorizeVersion(),
    secretId: getSecretId(),
    secretKey: getSecretKey(),
    region: getRegion(),
    replicateAvailable: !!getReplicateToken()
  };
}

module.exports = {
  getReplicateToken,
  getReplicateColorizeModels,
  getReplicateColorizeVersion,
  getSecretId,
  getSecretKey,
  getRegion,
  getAllCredentials
};
