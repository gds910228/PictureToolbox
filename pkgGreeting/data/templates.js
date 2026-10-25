// pkgGreeting/data/templates.js
// 今日问候 · 模板与文案配置（纯配置零素材：无图片资源 = 无版权风险、无包体负担）
//
// 组成：
//   TEMPLATES      6 套浅色渐变模板（bg 三段渐变 / text 主文字色 / sub 次要文字色）
//   SLOTS          时段问候（按当前小时自动预选）
//   BLESSING_POOLS 各时段本地祝福池（无 AI 时功能完整可用的兜底）
//   FESTIVAL_POOL / TERM_POOL  场合祝福池（节日/节气日排在时段池前面）
//   getOccasion(date) / getUpcomingOccasions(from, count) / formatDate(date) / slotIdByHour(hour)
//
// 日期引擎（v2）：农历节日与节气由 vendor 的 solarlunar 天文数据换算（覆盖 1900-2100，
//   闰月有标记），公历固定节日为日历恒真，母亲节/父亲节按星期规则推算——
//   **不再维护年度写死表**，跨年无需更新代码。
// 语气约定：面向长辈，短句、口语、无网络梗、无生僻字。

// 六套浅色模板：颜色只用于问候图渲染，与全局赛博朋克主题互不影响
const TEMPLATES = [
  { id: 'dawn',   name: '晨光', bg: ['#FFF3DC', '#FFE3B0', '#FFC98F'], text: '#7A4A10', sub: '#A87B3F' },
  { id: 'sunset', name: '暮霞', bg: ['#FFEBE3', '#FFD4C2', '#F5A98A'], text: '#8A3D20', sub: '#B26A4E' },
  { id: 'jade',   name: '青玉', bg: ['#EAF7EE', '#CDEBD6', '#A8D9BB'], text: '#1F5C38', sub: '#4E8566' },
  { id: 'rose',   name: '霞粉', bg: ['#FDEFF3', '#FAD9E4', '#F0B7CC'], text: '#93395B', sub: '#B76A88' },
  { id: 'azure',  name: '晴空', bg: ['#EAF4FF', '#CFE6FB', '#A8CCF0'], text: '#1E4E7E', sub: '#4E7CA3' },
  { id: 'pine',   name: '松雪', bg: ['#F2F4EF', '#DFE6D5', '#C2CFB2'], text: '#3E5528', sub: '#6B7F55' }
];

// 时段：早安 5-11 点 / 日安 11-17 点 / 晚安 17-次日5 点
const SLOTS = [
  { id: 'morning', label: '早安' },
  { id: 'day',     label: '日安' },
  { id: 'night',   label: '晚安' }
];

const BLESSING_POOLS = {
  morning: [
    '晨光正好，愿你今天顺顺利利',
    '新的一天，平安喜乐',
    '早安，愿你笑口常开',
    '清晨问声好，一天好心情',
    '愿今日阳光，温暖你我心',
    '早上好，吃好睡好身体好',
    '太阳出来啦，精神满满一整天',
    '起个大早，好事自来',
    '早安，愿你走路带风，办事顺风',
    '一杯热茶，一句早安，日子真舒坦',
    '天气好好，心情也要好好',
    '早安，把好运气都装进口袋'
  ],
  day: [
    '愿你天天都有好心情',
    '平安是福，健康是宝',
    '日子舒心，家人安康',
    '愿所有美好如约而至',
    '心宽体健，笑口常开',
    '把日子过得热气腾腾',
    '午后阳光正好，适合想念亲人',
    '忙里偷闲，喝口水歇一歇',
    '愿你吃得香、睡得稳、身体棒',
    '家人闲坐，灯火可亲',
    '好日子不在别处，就在眼前',
    '平平淡淡才是真，健健康康就是福'
  ],
  night: [
    '夜色温柔，愿你一夜好梦',
    '晚安，明天又是新的一天',
    '晚风轻轻，送你一夜安眠',
    '灯火可亲，晚安好梦',
    '今日辛苦了，早点休息',
    '愿你梦里星光，醒来晴朗',
    '晚安，好梦，一觉到天亮',
    '忙了一天，好好犒劳自己',
    '星星都亮了，该休息啦',
    '放下一天的琐事，睡个好觉',
    '晚安，愿家人都平安',
    '夜深了，盖上被子，暖乎乎地睡'
  ]
};

// 场合祝福池：今天有节日/节气时排在时段池前面（节日/节气名已由成品标题表达，
// 这里只写与其氛围相配的通用句，避免拼接生硬）
const FESTIVAL_POOL = [
  '愿阖家团圆，幸福美满',
  '节日快乐，好运连连',
  '愿家家和睦，岁岁平安',
  '好日子配好照片，喜事成双',
  '举杯同庆，愿年年有今日',
  '热热闹闹过佳节，欢欢喜喜迎好运'
];

const TERM_POOL = [
  '天凉记得添衣，愿你安康',
  '应时而食，顺时而活，日子安稳',
  '风调雨顺，愿这一季都顺遂',
  '节气更替，问候不变',
  '一份牵挂，随节气送到你身边',
  '愿你三餐四季，平安喜乐'
];

// ---------- 日期引擎（农历换算 + 天文节气，见文件头说明） ----------

const lunarLib = (require('../utils/solarlunar.js').default) || require('../utils/solarlunar.js');

// 二十四节气名（getTerm 的 n 为 1 基序数：n=1 小寒 … n=24 冬至，月份 = ceil(n/2)）
const TERM_NAMES = [
  '小寒', '大寒', '立春', '雨水', '惊蛰', '春分',
  '清明', '谷雨', '立夏', '小满', '芒种', '夏至',
  '小暑', '大暑', '立秋', '处暑', '白露', '秋分',
  '寒露', '霜降', '立冬', '小雪', '大雪', '冬至'
];

// 公历固定节日（月-日 → 名称，年年恒准）
const GREGORIAN_FESTIVALS = {
  '01-01': '元旦',
  '03-08': '妇女节',
  '03-12': '植树节',
  '05-01': '劳动节',
  '06-01': '儿童节',
  '07-01': '建党节',
  '08-01': '建军节',
  '09-10': '教师节',
  '10-01': '国庆节',
  '12-25': '圣诞节'
};

// 农历节日（农历月-日 → 名称；民间习惯不按闰月过，isLeap 的日期不匹配）
const LUNAR_FESTIVALS = {
  '1-1': '春节',
  '1-15': '元宵节',
  '5-5': '端午节',
  '7-7': '七夕节',
  '8-15': '中秋节',
  '9-9': '重阳节',
  '12-8': '腊八节'
};

/** 某年某月第 n 个星期 w（0=周日）的日期（母亲节/父亲节用） */
function nthWeekday(year, month, weekday, n) {
  const first = new Date(year, month - 1, 1);
  const offset = (weekday - first.getDay() + 7) % 7;
  return 1 + offset + (n - 1) * 7;
}

/** 当天的节日（公历固定 / 星期规则 / 农历 / 除夕），无则 null */
function festivalOfDay(date) {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const mdKey = `${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  if (GREGORIAN_FESTIVALS[mdKey]) return { name: GREGORIAN_FESTIVALS[mdKey], type: 'festival' };

  if (m === 5 && d === nthWeekday(y, 5, 0, 2)) return { name: '母亲节', type: 'festival' };
  if (m === 6 && d === nthWeekday(y, 6, 0, 3)) return { name: '父亲节', type: 'festival' };

  const lunar = lunarLib.solar2lunar(y, m, d);
  if (lunar && !lunar.isLeap) {
    const lunarKey = `${lunar.lMonth}-${lunar.lDay}`;
    if (LUNAR_FESTIVALS[lunarKey]) return { name: LUNAR_FESTIVALS[lunarKey], type: 'festival' };
  }

  // 除夕：明天是正月初一（非闰月），今天即除夕（腊月廿九或三十都覆盖）
  const next = new Date(y, m - 1, d + 1);
  const nextLunar = lunarLib.solar2lunar(next.getFullYear(), next.getMonth() + 1, next.getDate());
  if (nextLunar && nextLunar.lMonth === 1 && nextLunar.lDay === 1 && !nextLunar.isLeap) {
    return { name: '除夕', type: 'festival' };
  }

  return null;
}

/** 当天的节气（只查本月两个序数），无则 null */
function termOfDay(date) {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const n1 = (m - 1) * 2 + 1;
  if (lunarLib.getTerm(y, n1) === d) return { name: TERM_NAMES[n1 - 1], type: 'term' };
  if (lunarLib.getTerm(y, n1 + 1) === d) return { name: TERM_NAMES[n1], type: 'term' };
  return null;
}

/**
 * 今天是什么日子：节日优先于节气（如清明当天同时是节气清明，返回节气的"清明"）。
 * @param {Date} date
 * @returns {{name:string, type:'festival'|'term'}|null}
 */
function getOccasion(date) {
  return festivalOfDay(date) || termOfDay(date);
}

/**
 * 近期节日/节气：从 from 当天起顺扫（最多 120 天），返回前 count 个。
 * @param {Date} from
 * @param {number} count
 * @returns {Array<{name:string, type:'festival'|'term', monthDay:string, daysUntil:number}>}
 */
function getUpcomingOccasions(from, count) {
  const result = [];
  for (let i = 0; i < 120 && result.length < count; i++) {
    const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i);
    const occ = festivalOfDay(d) || termOfDay(d);
    if (occ) {
      result.push({
        name: occ.name,
        type: occ.type,
        monthDay: `${d.getMonth() + 1}月${d.getDate()}日`,
        daysUntil: i
      });
    }
  }
  return result;
}

/**
 * 日期展示文案，如 "10月23日"。
 */
function formatDate(date) {
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

/**
 * 按小时取时段 id（与 SLOTS 对应）。
 */
function slotIdByHour(hour) {
  if (hour >= 5 && hour < 11) return 'morning';
  if (hour >= 11 && hour < 17) return 'day';
  return 'night';
}

/**
 * 组合祝福池：节日/节气日把对应场合池排在时段池前面，让默认句也能"应景"。
 * @param {string} slotId 时段 id
 * @param {{name:string,type:'festival'|'term'}|null} occ getOccasion 的返回
 */
function getBlessingPool(slotId, occ) {
  const base = BLESSING_POOLS[slotId] || BLESSING_POOLS.day;
  if (!occ) return base;
  return (occ.type === 'festival' ? FESTIVAL_POOL : TERM_POOL).concat(base);
}

module.exports = {
  TEMPLATES,
  SLOTS,
  BLESSING_POOLS,
  getOccasion,
  getUpcomingOccasions,
  formatDate,
  slotIdByHour,
  getBlessingPool
};
