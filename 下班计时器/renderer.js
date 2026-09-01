/* ================= 常量 ================= */
// 上班到推荐下班的总时长：7.75小时工时 + 1.5小时午休 = 9小时15分钟
const TOTAL_MIN = 9 * 60 + 15;   // 555 分钟
// 午休时长
const LUNCH_MIN = 90;            // 90 分钟
// 每日标准出勤工时：7.75 小时
const BASE_MIN = 7 * 60 + 45;    // 465 分钟

// 补贴档位（按实际出勤工时，单位：小时）
const SUBSIDY_LEVELS = [
  { minHours: 11.5, amount: 100 },
  { minHours: 10, amount: 60 },
  { minHours: 9, amount: 30 }
];

/* ================= 2026年放假调休安排（国办发明电〔2025〕7号） ================= */
// 法定节假日（含调休连休日）
const HOLIDAYS = new Set([
  '2026-01-01', '2026-01-02', '2026-01-03',
  '2026-02-15', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19',
  '2026-02-20', '2026-02-21', '2026-02-22', '2026-02-23',
  '2026-04-04', '2026-04-05', '2026-04-06',
  '2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05',
  '2026-06-19', '2026-06-20', '2026-06-21',
  '2026-09-25', '2026-09-26', '2026-09-27',
  '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05',
  '2026-10-06', '2026-10-07'
]);

// 调休上班日（周末补班）
const EXTRA_WORKDAYS = new Set([
  '2026-01-04', '2026-02-14', '2026-02-28',
  '2026-05-09', '2026-09-20', '2026-10-10'
]);

// 判断某天是否为工作日（含调休；休息日不计入出勤）
function isWorkday(key) {
  if (EXTRA_WORKDAYS.has(key)) return true;
  if (HOLIDAYS.has(key)) return false;
  const [y, mo, d] = key.split('-').map(Number);
  const wd = new Date(y, mo - 1, d).getDay();
  return wd >= 1 && wd <= 5;
}

/* ================= 工具函数 ================= */
const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, '0');

function dateKey(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function storageKey(key) {
  return 'workday-' + key;
}

function getRecord(key) {
  try {
    const raw = localStorage.getItem(storageKey(key));
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function setRecord(key, rec) {
  localStorage.setItem(storageKey(key), JSON.stringify(rec));
}

function delRecord(key) {
  localStorage.removeItem(storageKey(key));
}

// 日历手动设置的出勤覆盖：{ 'YYYY-MM-DD': 'present' | 'absent' }
function getOverrides() {
  try {
    return JSON.parse(localStorage.getItem('attendance-overrides') || '{}');
  } catch (e) {
    return {};
  }
}

function setOverrides(map) {
  localStorage.setItem('attendance-overrides', JSON.stringify(map));
}

function parseHm(str) {
  const [h, m] = str.split(':').map(Number);
  return { h, m };
}

// 记录对应的上班时间戳
function startMsOf(key, rec) {
  const [y, mo, d] = key.split('-').map(Number);
  const { h, m } = parseHm(rec.start);
  return new Date(y, mo - 1, d, h, m).getTime();
}

// 记录对应的下班时间戳（未打卡返回 null）
function endMsOf(key, rec) {
  if (!rec.end) return null;
  const [y, mo, d] = key.split('-').map(Number);
  const { h, m } = parseHm(rec.end);
  return new Date(y, mo - 1, d, h, m).getTime();
}

// 根据实际出勤工时（小时）计算补贴
function subsidyFor(workHours) {
  for (const level of SUBSIDY_LEVELS) {
    if (workHours > level.minHours) return level.amount;
  }
  return 0;
}

// 午休固定时段：当天 12:30 - 14:00（只有落在午休时段内的在岗时间才扣除）
const LUNCH_START_H = 12, LUNCH_START_M = 30;
const LUNCH_END_H = 14, LUNCH_END_M = 0;

// 计算在岗区间与当天午休固定时段的重叠时长（分钟）
function lunchOverlapMin(startMs, endMs) {
  const d = new Date(startMs);
  const lunchStart = new Date(d.getFullYear(), d.getMonth(), d.getDate(), LUNCH_START_H, LUNCH_START_M).getTime();
  const lunchEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate(), LUNCH_END_H, LUNCH_END_M).getTime();
  return Math.max(0, Math.min(endMs, lunchEnd) - Math.max(startMs, lunchStart)) / 60000;
}

// 根据某一时刻的在岗时长（毫秒差）计算 工时/加班/补贴
function calcDay(startMs, endMs) {
  const stayMin = Math.max(0, (endMs - startMs) / 60000);
  // 实际工时 = 在岗时长 - 在岗期间覆盖的午休时间（固定时段 12:30-14:00）：
  // 12:30 之前不扣；午休期间工时冻结；最多扣 1.5 小时。
  // 加班与补贴档位均基于扣除午休后的实际工时计算。
  const workMin = Math.max(0, stayMin - lunchOverlapMin(startMs, endMs));
  const overtimeMin = Math.max(0, workMin - BASE_MIN);
  return {
    workMin,
    overtimeMin,
    subsidy: subsidyFor(workMin / 60)
  };
}

function fmtDuration(min) {
  const total = Math.floor(min);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h}小时${pad(m)}分`;
}

function fmtMoney(amount) {
  return amount > 0 ? `已获得补贴${amount}元` : '暂无补贴';
}

/* ================= 全局状态 ================= */
let flashActive = false;        // 是否正在闪烁
let lastDismissTime = 0;        // 上次手动停止闪烁的时间戳
const FLASH_COOLDOWN = 2 * 60 * 1000; // 停止闪烁后 2 分钟冷却期
let lastTriggerTarget = 0;      // 上次触发闪烁的目标时间戳（防止同一节点重复触发）

// 将过往日期未结算的记录自动按当日 23:59 结算，并固化快照数据（无需手动打卡）
function finalizePastRecords() {
  const nowDate = new Date();
  const today = dateKey(nowDate);
  const curMonthPrefix = `${nowDate.getFullYear()}-${pad(nowDate.getMonth() + 1)}-`;
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const storageKeyStr = localStorage.key(i);
    if (!storageKeyStr || !storageKeyStr.startsWith('workday-')) continue;
    const key = storageKeyStr.slice('workday-'.length);
    // 只处理当月记录；非当月（含改系统时间测试产生的残留）直接清理，不计入任何统计
    if (!key.startsWith(curMonthPrefix)) {
      localStorage.removeItem(storageKeyStr);
      continue;
    }
    if (key < today) {
      const rec = getRecord(key);
      if (rec && !rec.end) {
        rec.end = '23:59';
        const day = calcDay(startMsOf(key, rec), endMsOf(key, rec));
        rec.workMin = Math.round(day.workMin * 100) / 100;
        rec.overtimeMin = Math.round(day.overtimeMin * 100) / 100;
        rec.subsidy = day.subsidy;
        setRecord(key, rec);
      }
    }
  }

  // 同步清理非当月的出勤手动标记，保证出勤天数只反映当月
  const overrides = getOverrides();
  let changed = false;
  Object.keys(overrides).forEach((key) => {
    if (!key.startsWith(curMonthPrefix)) {
      delete overrides[key];
      changed = true;
    }
  });
  if (changed) setOverrides(overrides);
}

/* ================= 视图渲染 ================= */
function renderViews() {
  const today = dateKey(new Date());
  const rec = getRecord(today);

  if (rec) {
    $('view-input').classList.add('hidden');
    $('view-timer').classList.remove('hidden');

    $('t-start').textContent = rec.start;
    const offMs = startMsOf(today, rec) + TOTAL_MIN * 60000;
    const off = new Date(offMs);
    $('t-off').textContent = `${pad(off.getHours())}:${pad(off.getMinutes())}`;

    const cdValue = $('cd-value');
    if (rec.end) {
      // 已打卡：显示固定结果（快照数据）
      $('cd-label').textContent = '今日已打卡下班';
      cdValue.textContent = `下班时间 ${rec.end}`;
      cdValue.classList.add('text');

      const day = getRecordDay(today, rec);
      $('t-work').textContent = fmtDuration(day.workMin);
      $('t-overtime').textContent = fmtDuration(day.overtimeMin);
      $('t-subsidy').textContent = fmtMoney(day.subsidy);

      $('btn-clockout').classList.add('hidden');
      $('btn-reset').classList.add('hidden');
      stopFlash();
    } else {
      cdValue.classList.remove('text');
      $('btn-clockout').classList.remove('hidden');
      $('btn-reset').classList.remove('hidden');
    }
  } else {
    $('view-input').classList.remove('hidden');
    $('view-timer').classList.add('hidden');
    stopFlash();
  }
}

// 获取记录的工时/加班/补贴：已打卡用固化快照，未打卡实时计算
function getRecordDay(key, rec) {
  if (rec.end && rec.workMin != null) {
    return {
      workMin: rec.workMin,
      overtimeMin: rec.overtimeMin,
      subsidy: rec.subsidy || 0
    };
  }
  const startMs = startMsOf(key, rec);
  const endMs = endMsOf(key, rec) || Date.now();
  return calcDay(startMs, endMs);
}

function renderStats() {
  const now = new Date();
  const y = now.getFullYear();
  const mo = now.getMonth();
  const daysInMonth = new Date(y, mo + 1, 0).getDate();
  const today = now.getDate();

  // 显示当前统计月份，避免与其他月份数据混淆
  const monthLabel = `（${y}年${mo + 1}月）`;
  $('stats-month').textContent = monthLabel;
  $('records-month').textContent = monthLabel;

  let attended = 0;
  let decidedDays = 0;
  let workDays = 0;
  let recDays = 0;
  let overtimeSum = 0;
  let subsidySum = 0;
  const records = [];
  const overrides = getOverrides();

  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${y}-${pad(mo + 1)}-${pad(d)}`;
    const rec = getRecord(key);

    // 双保险：仅统计当月记录（日期键必须以当年当月开头）
    if (rec && key.startsWith(`${y}-${pad(mo + 1)}-`)) {
      recDays++;
      const day = getRecordDay(key, rec);
      records.push({ key, d, rec, day });
      overtimeSum += day.overtimeMin;
      // 累计补贴：过往已结算天 + 当天实时补贴都计入
      subsidySum += day.subsidy;
    }

    // 出勤统计新口径：
    // 出勤天数只统计已发生且实际出勤的天（当天输入后才计入），
    // 还没到的日期不计入、不提前扣；哪天实际缺勤就从哪天开始扣除。
    // 出勤率 = 已出勤天数 / 已过且已定的工作日天数。
    const ov = overrides[key];
    const workday = isWorkday(key);
    if (workday) {
      workDays++;
      // “已定”：今天之前的日期，或今天已有记录/手动标记
      const decided = d < today || (d === today && (rec || ov !== undefined));
      if (decided) {
        decidedDays++;
        if (ov === 'present') attended += 1;
        else if (ov === 'present-am' || ov === 'present-pm') attended += 0.5;
        else if (ov !== 'absent' && rec) attended += 1;
      }
    } else if (ov === 'present' || ov === 'present-am' || ov === 'present-pm') {
      // 休息日手动标记出勤（如调休补班未配置时）；半天按 0.5 天计
      workDays++;
      if (d <= today) {
        decidedDays++;
        attended += ov === 'present' ? 1 : 0.5;
      }
    }
  }

  const rate = decidedDays > 0 ? (attended / decidedDays) * 100 : 100;
  const rateEl = $('s-rate');
  rateEl.textContent = rate.toFixed(1) + '%';
  rateEl.classList.toggle('rate-red', rate > 90);
  rateEl.classList.toggle('rate-blue', rate <= 90);

  $('s-attend').textContent = `${attended} / ${workDays} 天`;
  $('s-subsidy').textContent = subsidySum > 0 ? `¥${subsidySum}` : '¥0';
  $('s-avg-ot').textContent =
    attended > 0 && overtimeSum > 0 ? fmtDuration(overtimeSum / attended) : '0小时00分';

  // 记录列表（倒序）
  const listEl = $('record-list');
  listEl.innerHTML = '';
  if (records.length === 0) {
    listEl.innerHTML = '<div class="empty">暂无记录</div>';
  } else {
    records.reverse().forEach((item) => {
      const row = document.createElement('div');
      row.className = 'record-row';

      const dateSpan = document.createElement('span');
      dateSpan.className = 'rec-date';
      dateSpan.textContent = `${pad(mo + 1)}-${pad(item.d)}`;

      const infoSpan = document.createElement('span');
      infoSpan.className = 'rec-info';
      infoSpan.textContent = `工时 ${fmtDuration(item.day.workMin)} · 加班 ${fmtDuration(item.day.overtimeMin)}`;

      const subSpan = document.createElement('span');
      subSpan.className = 'rec-sub';
      subSpan.textContent = item.day.subsidy > 0 ? `¥${item.day.subsidy}` : '-';

      const delBtn = document.createElement('button');
      delBtn.className = 'rec-del';
      delBtn.textContent = '删除';
      delBtn.addEventListener('click', () => {
        if (confirm(`确定删除 ${item.key} 的记录吗？`)) {
          delRecord(item.key);
          lastDismissTime = 0;
          lastTriggerTarget = 0;
          renderAll();
        }
      });

      row.appendChild(dateSpan);
      row.appendChild(infoSpan);
      row.appendChild(subSpan);
      row.appendChild(delBtn);
      listEl.appendChild(row);
    });
  }
}

function renderAll() {
  renderViews();
  renderStats();
}

/* ================= 出勤日历 ================= */
function renderCalendar() {
  const now = new Date();
  const y = now.getFullYear();
  const mo = now.getMonth();
  const daysInMonth = new Date(y, mo + 1, 0).getDate();
  const firstWeekday = (new Date(y, mo, 1).getDay() + 6) % 7; // 周一=0
  const overrides = getOverrides();

  $('cal-title').textContent = `${y}年${mo + 1}月 出勤日历`;
  const grid = $('cal-grid');
  grid.innerHTML = '';

  for (let i = 0; i < firstWeekday; i++) {
    const blank = document.createElement('div');
    blank.className = 'cal-cell blank';
    grid.appendChild(blank);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${y}-${pad(mo + 1)}-${pad(d)}`;
    const rec = getRecord(key);
    const ov = overrides[key];
    const workday = isWorkday(key);

    const cell = document.createElement('div');
    cell.className = 'cal-cell';
    const numSpan = document.createElement('span');
    numSpan.textContent = d;
    cell.appendChild(numSpan);

    // 假日/补班小角标
    if (HOLIDAYS.has(key)) {
      const badge = document.createElement('i');
      badge.className = 'cal-badge';
      badge.textContent = '休';
      cell.appendChild(badge);
    } else if (EXTRA_WORKDAYS.has(key)) {
      const badge = document.createElement('i');
      badge.className = 'cal-badge work';
      badge.textContent = '班';
      cell.appendChild(badge);
    }

    if (!workday) cell.classList.add('rest');

    if (ov === 'present') cell.classList.add('present-manual');
    else if (ov === 'present-am') cell.classList.add('am-manual');
    else if (ov === 'present-pm') cell.classList.add('pm-manual');
    else if (ov === 'absent') cell.classList.add('absent-manual');
    else if (rec) cell.classList.add('present');
    else if (workday && d >= now.getDate()) cell.classList.add('future');
    else if (workday) cell.classList.add('absent');

    if (d === now.getDate()) cell.classList.add('today');

    // 鼠标悬停弹出选择菜单：出勤 / 出勤上半天 / 出勤下半天 / 缺勤
    cell.addEventListener('mouseenter', () => openCalMenu(key, cell));
    cell.addEventListener('mouseleave', scheduleCloseCalMenu);

    grid.appendChild(cell);
  }
}

function openCalendar() {
  renderCalendar();
  $('calendar-overlay').classList.remove('hidden');
}

function closeCalendar() {
  $('calendar-overlay').classList.add('hidden');
  $('cal-menu').classList.add('hidden');
}

/* ================= 日历悬浮选择菜单 ================= */
let calMenuKey = null;
let calMenuTimer = null;

function openCalMenu(key, cell) {
  clearTimeout(calMenuTimer);
  calMenuKey = key;
  const menu = $('cal-menu');
  const cur = getOverrides()[key] || '';
  menu.querySelectorAll('.cal-menu-item').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.val === cur);
  });
  menu.classList.remove('hidden');
  const oRect = $('calendar-overlay').getBoundingClientRect();
  const cRect = cell.getBoundingClientRect();
  let left = cRect.left - oRect.left + cRect.width / 2 - menu.offsetWidth / 2;
  left = Math.max(8, Math.min(left, oRect.width - menu.offsetWidth - 8));
  let top = cRect.bottom - oRect.top + 4;
  if (top + menu.offsetHeight > oRect.height - 8) {
    top = cRect.top - oRect.top - menu.offsetHeight - 4;
  }
  menu.style.left = `${left}px`;
  menu.style.top = `${Math.max(4, top)}px`;
}

function scheduleCloseCalMenu() {
  clearTimeout(calMenuTimer);
  calMenuTimer = setTimeout(() => {
    $('cal-menu').classList.add('hidden');
    calMenuKey = null;
  }, 160);
}

/* ================= 闪烁控制 ================= */
function startFlash() {
  if (flashActive) return;
  flashActive = true;
  document.body.classList.add('flashing');
  $('flash-banner').classList.remove('hidden');
}

function stopFlash() {
  if (!flashActive) return;
  flashActive = false;
  document.body.classList.remove('flashing');
  $('flash-banner').classList.add('hidden');
}

/* ================= 每秒刷新 ================= */
// 补贴档位对应的实际工时分钟数：9小时 / 10小时 / 11.5小时
const TIER_WORK_MIN = [9 * 60, 10 * 60, 11.5 * 60];
const TIER_LABELS = ['30 元', '60 元', '100 元'];
const TIER_AMOUNTS = [30, 60, 100];

// 达到某工时档位的目标时刻 = 上班时刻 + 档位工时 + 期间覆盖的午休时间（固定时段 12:30-14:00）
function tierTargetMs(startMs, tierMin) {
  let targetMs = startMs + tierMin * 60000;
  for (let k = 0; k < 3; k++) {
    targetMs = startMs + (tierMin + lunchOverlapMin(startMs, targetMs)) * 60000;
  }
  return targetMs;
}

/* ================= 补贴栏悬浮说明 ================= */
function buildSubsidyTip() {
  const today = dateKey(new Date());
  const rec = getRecord(today);
  const tip = $('subsidy-tip');
  if (!rec) return;
  const startMs = startMsOf(today, rec);
  const day = getRecordDay(today, rec);
  const startD = new Date(startMs);
  let html = '<div class="subsidy-tip-title">补贴档位说明（实际工时已扣午休）</div>';
  TIER_WORK_MIN.forEach((tierMin, i) => {
    if (day.workMin > tierMin) {
      html += `<div class="subsidy-tip-row done"><span>实际工时超 ${tierMin / 60} 小时</span><span>已获 ${TIER_AMOUNTS[i]} 元 ✓</span></div>`;
    } else {
      const t = new Date(tierTargetMs(startMs, tierMin));
      const crossDay = t.getDate() !== startD.getDate() ? '次日 ' : '';
      html += `<div class="subsidy-tip-row"><span>加班到 ${crossDay}${pad(t.getHours())}:${pad(t.getMinutes())}</span><span>可获 ${TIER_AMOUNTS[i]} 元</span></div>`;
    }
  });
  tip.innerHTML = html;
}

function tick() {
  const now = new Date();
  const today = dateKey(now);
  const rec = getRecord(today);
  if (!rec || rec.end) return;

  const startMs = startMsOf(today, rec);
  const nowMs = now.getTime();
  const offMs = startMs + TOTAL_MIN * 60000;
  const day = calcDay(startMs, nowMs);

  // 动态倒计时：未到下班时间→倒计时下班；已过下班时间→倒计时下一个补贴档位
  let label;
  let targetMs;
  if (nowMs < offMs) {
    label = '距离推荐下班时间';
    targetMs = offMs;
  } else {
    let tierIndex = -1;
    for (let i = 0; i < TIER_WORK_MIN.length; i++) {
      if (day.workMin <= TIER_WORK_MIN[i]) {
        tierIndex = i;
        break;
      }
    }
    if (tierIndex >= 0) {
      label = `距离补贴 ${TIER_LABELS[tierIndex]} 档位（实际工时满 ${TIER_WORK_MIN[tierIndex] / 60} 小时）`;
      targetMs = tierTargetMs(startMs, TIER_WORK_MIN[tierIndex]);
    } else {
      label = '已达最高补贴档位';
      targetMs = null;
    }
  }

  $('cd-label').textContent = label;
  if (targetMs !== null) {
    const diff = Math.max(0, targetMs - nowMs);
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    $('cd-value').textContent = `${pad(h)}:${pad(m)}:${pad(s)}`;
  } else {
    $('cd-value').textContent = '已获得补贴100元';
  }

  // 到推荐下班时间或补贴时间节点时整页白色高亮闪烁（无声）
  if (nowMs >= offMs) {
    // 确定当前应触发闪烁的时间节点
    let triggerMs = offMs;
    let bannerText = '到点啦！可以下班了';
    // 已过下班时间，检查是否到达补贴档位时间节点
    for (let i = 0; i < TIER_WORK_MIN.length; i++) {
      const tTarget = tierTargetMs(startMs, TIER_WORK_MIN[i]);
      if (nowMs >= tTarget) {
        triggerMs = tTarget;
        bannerText = `已达到补贴 ${TIER_LABELS[i]} 档位（实际工时满 ${TIER_WORK_MIN[i] / 60} 小时）`;
      }
    }
    // 仅在到达新的时间节点时触发（避免同一节点重复触发）
    if (triggerMs !== lastTriggerTarget) {
      // 冷却期内不重复闪烁
      if (Date.now() - lastDismissTime > FLASH_COOLDOWN || lastDismissTime === 0) {
        $('flash-banner').querySelector('span').textContent = bannerText;
        lastTriggerTarget = triggerMs;
        startFlash();
      }
    }
  }

  $('t-work').textContent = fmtDuration(day.workMin);
  $('t-overtime').textContent = fmtDuration(day.overtimeMin);
  $('t-subsidy').textContent = fmtMoney(day.subsidy);
}

/* ================= 事件绑定 ================= */
function bindEvents() {
  // 窗口控制
  $('btn-min').addEventListener('click', () => window.winControl.minimize());
  $('btn-close').addEventListener('click', () => window.winControl.close());

  // 输入时实时预览推荐下班时间
  const preview = () => {
    const h = parseInt($('input-hour').value, 10);
    const m = parseInt($('input-minute').value, 10);
    const el = $('off-preview');
    if (Number.isInteger(h) && Number.isInteger(m) && h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      const off = new Date();
      off.setHours(h, m, 0, 0);
      off.setMinutes(off.getMinutes() + TOTAL_MIN);
      el.textContent = `推荐下班时间：${pad(off.getHours())}:${pad(off.getMinutes())}`;
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  };
  $('input-hour').addEventListener('input', preview);
  $('input-minute').addEventListener('input', preview);

  // 开始计时
  $('btn-start').addEventListener('click', () => {
    const h = parseInt($('input-hour').value, 10);
    const m = parseInt($('input-minute').value, 10);
    if (!Number.isInteger(h) || h < 0 || h > 23) {
      alert('请输入正确的上班时间（时：0 - 23）');
      return;
    }
    if (!Number.isInteger(m) || m < 0 || m > 59) {
      alert('请输入正确的上班时间（分：0 - 59）');
      return;
    }
    setRecord(dateKey(new Date()), { start: `${pad(h)}:${pad(m)}`, end: null });
    lastDismissTime = 0;
    lastTriggerTarget = 0;
    renderAll();
  });

  // 下班打卡：固化保存当日工时/加班/补贴快照
  $('btn-clockout').addEventListener('click', () => {
    const today = dateKey(new Date());
    const rec = getRecord(today);
    if (!rec || rec.end) return;
    if (!confirm('确认现在下班打卡吗？打卡后当日工时、加班与补贴将固定保存。')) return;
    const now = new Date();
    const day = calcDay(startMsOf(today, rec), now.getTime());
    rec.end = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    rec.workMin = Math.round(day.workMin * 100) / 100;
    rec.overtimeMin = Math.round(day.overtimeMin * 100) / 100;
    rec.subsidy = day.subsidy;
    setRecord(today, rec);
    stopFlash();
    renderAll();
  });

  // 重新输入（删除当日未打卡记录）
  $('btn-reset').addEventListener('click', () => {
    const today = dateKey(new Date());
    const rec = getRecord(today);
    if (!rec) return;
    if (rec.end) {
      alert('今日已打卡，如需更正请在下方记录列表中删除。');
      return;
    }
    if (!confirm('确定清除今天的上班时间并重新输入吗？')) return;
    delRecord(today);
    lastDismissTime = 0;
    lastTriggerTarget = 0;
    renderAll();
  });

  // 停止闪烁（记录停止时间，2 分钟后到达新补贴节点会重新触发）
  $('btn-stop-flash').addEventListener('click', () => {
    lastDismissTime = Date.now();
    stopFlash();
  });

  // 出勤日历
  $('stat-attend').addEventListener('click', openCalendar);
  $('cal-close').addEventListener('click', closeCalendar);
  $('calendar-overlay').addEventListener('click', (e) => {
    if (e.target === $('calendar-overlay')) closeCalendar();
  });

  // 日历悬浮选择菜单：选项点击写入手动标记，半天按 0.5 天计入出勤率
  const calMenu = $('cal-menu');
  calMenu.addEventListener('mouseenter', () => clearTimeout(calMenuTimer));
  calMenu.addEventListener('mouseleave', scheduleCloseCalMenu);
  calMenu.querySelectorAll('.cal-menu-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!calMenuKey) return;
      const map = getOverrides();
      const val = btn.dataset.val;
      if (val === 'clear') delete map[calMenuKey];
      else map[calMenuKey] = val;
      setOverrides(map);
      calMenu.classList.add('hidden');
      calMenuKey = null;
      renderCalendar();
      renderStats();
    });
  });

  // 补贴栏悬停显示各档位达成时刻说明（仅计时视图存在时有效）
  const subsidyRow = document.querySelector('.subsidy-row');
  if (subsidyRow) {
    subsidyRow.addEventListener('mouseenter', () => {
      if ($('view-timer').classList.contains('hidden')) return;
      buildSubsidyTip();
      $('subsidy-tip').classList.remove('hidden');
    });
    subsidyRow.addEventListener('mouseleave', () => {
      $('subsidy-tip').classList.add('hidden');
    });
  }
}

/* ================= 启动 ================= */
finalizePastRecords();
bindEvents();
renderAll();
tick();
setInterval(tick, 1000);
// 每分钟刷新一次统计（跨天自动结算、当天补贴实时计入）
setInterval(() => {
  finalizePastRecords();
  renderStats();
}, 60000);
