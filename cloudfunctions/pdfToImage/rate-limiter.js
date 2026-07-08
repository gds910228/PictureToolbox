// rate-limiter.js — 统一限流模块（云函数端）
//
// canonical 源：cloudfunctionTemplate/rate-limiter.js
// 每个需要限流的云函数各持一份相同副本（微信云函数为隔离部署单元，无法跨目录 require）。
//
// 设计（项目统一约定，详见 memory rate-limiter-convention）：
//   - 集合：rate_limit（需在云开发控制台手动创建）
//   - 文档 _id：`${openid}_${featureKey}_${YYYY-MM-DD(北京时区)}`
//     · featureKey 区分功能（outpaint / caption / avatar / text2img / pdftoimage ...），
//       各功能计数独立、互不共享额度。
//   - 字段：{ openid, feature, date, count, updatedAt }
//   - 限额：从环境变量 RATE_LIMIT_DAILY 读取（控制台可改，免改代码重新部署）；
//     未设或非法时回退 DEFAULT_LIMIT。
//   - 计数：inc(1) 原子自增；文档不存在时 add；集合缺失/异常 → 降级放行（不阻断主流程）。
//   - 时区：云函数跑 UTC，按日计数用北京时间（+8）。
//
// 用法：
//   const rateLimiter = require('./rate-limiter');
//   const rl = await rateLimiter.checkRateLimit(openid, 'pdftoimage', cloud);
//   if (!rl.ok) return { success:false, error:'rate_limit', used:rl.used, limit:rl.limit };
//   // ... 业务逻辑 ...
//   return { success:true, used: rl.used, limit: rl.limit };
//
//   const q = await rateLimiter.queryQuota(openid, 'pdftoimage', cloud);  // 只读，不计数

const COLLECTION = 'rate_limit';
const DEFAULT_LIMIT = 20;

/**
 * 解析当日限额：优先环境变量 RATE_LIMIT_DAILY，非法/未设回退 DEFAULT_LIMIT。
 */
function resolveLimit() {
  const v = parseInt(process.env.RATE_LIMIT_DAILY, 10);
  return isFinite(v) && v > 0 ? v : DEFAULT_LIMIT;
}

/**
 * 北京时间日期串 YYYY-MM-DD（云函数默认 UTC，手动 +8）。
 */
function beijingDateStr() {
  const beijing = new Date(Date.now() + 8 * 3600 * 1000);
  return beijing.toISOString().slice(0, 10);
}

/**
 * 限流检查：每 openid 每功能每日 limit 次（调用前计数，失败不退还，防恶意重试刷）。
 * @param {string} openid 用户 openid
 * @param {string} featureKey 功能标识（如 'pdftoimage'）
 * @param {object} cloud 已 cloud.init 的 wx-server-sdk 实例
 * @returns {{ok:boolean, used:number, limit:number, degraded?:boolean, reason?:string}}
 */
async function checkRateLimit(openid, featureKey, cloud) {
  const limit = resolveLimit();
  const PASS = { ok: true, used: 0, limit, degraded: true };
  if (!openid) return { ...PASS, reason: 'no_openid' };

  const db = cloud.database();
  const _ = db.command;
  const dateStr = beijingDateStr();
  const docId = `${openid}_${featureKey}_${dateStr}`;
  const now = new Date();

  try {
    // 先尝试自增（文档已存在）
    const upd = await db.collection(COLLECTION).doc(docId).update({
      data: { count: _.inc(1), updatedAt: now }
    });
    if (upd.stats && upd.stats.updated > 0) {
      const r = await db.collection(COLLECTION).doc(docId).get();
      const used = (r.data && r.data.count) || 0;
      return { ok: used <= limit, used, limit };
    }
    // updated===0：文档不存在 → 新建计数为 1
    await db.collection(COLLECTION).add({
      data: { _id: docId, openid, feature: featureKey, date: dateStr, count: 1, updatedAt: now }
    });
    return { ok: true, used: 1, limit };
  } catch (e) {
    // 集合不存在 / 并发 _id 冲突 → 降级放行（把 errMsg 带出，便于前端诊断）
    const errMsg = (e && (e.errMsg || e.message)) || String(e);
    console.error(
      `[rate-limiter] 限流检查异常(degraded)，feature=${featureKey}。` +
      '若为集合不存在，请在云开发控制台创建 ' + COLLECTION + ' 集合。',
      errMsg
    );
    return { ...PASS, reason: 'exception:' + errMsg };
  }
}

/**
 * 只读查询当日已用次数（不 inc、不消耗额度）。前端进页面展示额度条用。
 *  - 密钥态：读文档 count（文档不存在 = 今日首次 = 0）
 *  - 集合缺失/异常 → 降级返回 used:0（不阻断展示）
 * @param {string} openid
 * @param {string} featureKey
 * @param {object} cloud
 * @returns {{success:boolean, used:number, limit:number, degraded?:boolean, reason?:string}}
 */
async function queryQuota(openid, featureKey, cloud) {
  const limit = resolveLimit();
  if (!openid) return { success: true, used: 0, limit, degraded: true, reason: 'no_openid' };

  const dateStr = beijingDateStr();
  const docId = `${openid}_${featureKey}_${dateStr}`;
  try {
    const db = cloud.database();
    const r = await db.collection(COLLECTION).doc(docId).get();
    const used = (r.data && r.data.count) || 0;
    return { success: true, used, limit };
  } catch (e) {
    // 文档不存在（今日首次）或集合缺失 → 0 次，降级放行
    console.warn(
      `[rate-limiter] 查询额度异常(degraded)，feature=${featureKey}`,
      e && (e.errMsg || e.message)
    );
    return { success: true, used: 0, limit, degraded: true, reason: 'exception:' + ((e && (e.errMsg || e.message)) || String(e)) };
  }
}

module.exports = {
  checkRateLimit,
  queryQuota,
  resolveLimit,
  beijingDateStr,
  COLLECTION,
  DEFAULT_LIMIT
};
