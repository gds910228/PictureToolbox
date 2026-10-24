// pkgGreeting/data/templates.js
// 今日问候 · 模板与文案配置（纯配置零素材：无图片资源 = 无版权风险、无包体负担）
//
// 组成：
//   TEMPLATES      6 套浅色渐变模板（bg 三段渐变 / text 主文字色 / sub 次要文字色）
//   SLOTS          时段问候（按当前小时自动预选）
//   BLESSING_POOLS 各时段本地祝福池（无 AI 时功能完整可用的兜底）
//   FESTIVALS_2026 / SOLAR_TERMS_2026 年度节日/节气表（**年度维护点：每年需更新日期**）
//   getOccasion(date) / formatDate(date)  供页面取"今天是什么日子"
//
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

// 2026 年公历节日（月-日 → 名称）。农历/星期类节日已按 2026 年历换算；
// 年度维护点：跨年时更新本表与 SOLAR_TERMS_2026。
const FESTIVALS_2026 = {
  '01-01': '元旦',
  '02-17': '春节',
  '03-03': '元宵节',
  '03-08': '妇女节',
  '03-12': '植树节',
  '04-05': '清明节',
  '05-01': '劳动节',
  '05-10': '母亲节',
  '06-01': '儿童节',
  '06-19': '端午节',
  '06-21': '父亲节',
  '07-01': '建党节',
  '08-01': '建军节',
  '09-10': '教师节',
  '09-25': '中秋节',
  '10-01': '国庆节',
  '10-18': '重阳节',
  '12-25': '圣诞节'
};

// 2026 年二十四节气（公历近似日，个别年份 ±1 天，跨年时校准）
const SOLAR_TERMS_2026 = {
  '01-05': '小寒', '01-20': '大寒',
  '02-04': '立春', '02-19': '雨水',
  '03-05': '惊蛰', '03-20': '春分',
  '04-05': '清明', '04-20': '谷雨',
  '05-05': '立夏', '05-21': '小满',
  '06-05': '芒种', '06-21': '夏至',
  '07-07': '小暑', '07-23': '大暑',
  '08-07': '立秋', '08-23': '处暑',
  '09-08': '白露', '09-23': '秋分',
  '10-08': '寒露', '10-23': '霜降',
  '11-07': '立冬', '11-22': '小雪',
  '12-07': '大雪', '12-22': '冬至'
};

/**
 * 今天是什么日子：节日优先于节气（如 4月5日 清明节 > 清明）。
 * @param {Date} date
 * @returns {{name:string, type:'festival'|'term'}|null}
 */
function getOccasion(date) {
  const key = `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  if (FESTIVALS_2026[key]) return { name: FESTIVALS_2026[key], type: 'festival' };
  if (SOLAR_TERMS_2026[key]) return { name: SOLAR_TERMS_2026[key], type: 'term' };
  return null;
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
  formatDate,
  slotIdByHour,
  getBlessingPool
};
