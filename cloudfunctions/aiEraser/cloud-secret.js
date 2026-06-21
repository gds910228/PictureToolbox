// cloud-secret.js — 统一 API 密钥读取（云函数端）
// 本文件不含任何密钥值，可安全提交到 git。
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

// Replicate 模型名（如 twn39/lama），支持逗号分隔多个（按顺序尝试）
function getReplicateModels() {
  const val = _readEnv(['REPLICATE_MODELS', 'REPLICATE_MODEL'])
    || _localField('replicateModels')
    || 'twn39/lama';
  return val.split(',').map(s => s.trim()).filter(Boolean);
}

// Replicate LaMa 版本号（具体版本 hash，可选；不填则用模型最新版本）
function getReplicateLamaVersion() {
  return _readEnv(['REPLICATE_LAMA_VERSION', 'REPLICATE_VERSION'])
    || _localField('replicateLamaVersion');
}

// Hugging Face API Token
function getHfToken() {
  return _readEnv(['HF_API_TOKEN', 'HUGGING_FACE_TOKEN', 'HUGGINGFACE_TOKEN'])
    || _localField('hfToken');
}

// 腾讯云密钥（内容安全检测用）
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
    replicateModels: getReplicateModels(),
    replicateLamaVersion: getReplicateLamaVersion(),
    hfToken: getHfToken(),
    secretId: getSecretId(),
    secretKey: getSecretKey(),
    region: getRegion(),
    replicateAvailable: !!getReplicateToken(),
    hfAvailable: !!getHfToken(),
    tencentAvailable: !!getSecretId() && !!getSecretKey()
  };
}

module.exports = {
  getReplicateToken,
  getReplicateModels,
  getReplicateLamaVersion,
  getHfToken,
  getSecretId,
  getSecretKey,
  getRegion,
  getAllCredentials
};
