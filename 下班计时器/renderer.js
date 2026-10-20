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

/* ===== 数据层：内存 DB 为唯一数据源，每次改动落盘到 文档/下班计时器/出勤记录.json ===== */
const DB = { records: {} };
let saveTimer = null;

function getRecord(key) {
  return DB.records[key] || null;
}

function setRecord(key, rec) {
  DB.records[key] = rec;
  scheduleSave();
}

function delRecord(key) {
  delete DB.records[key];
  scheduleSave();
}

function jsonText() {
  return JSON.stringify({
    version: 1,
    updatedAt: new Date().toISOString(),
    records: DB.records
  }, null, 2);
}

// 同步生成一份 CSV，方便用 Excel 直接打开查看
function csvText() {
  const lines = ['日期,上班时间,下班时间,工时(小时),加班(小时),补贴(元),记录来源'];
  Object.keys(DB.records).sort().forEach((key) => {
    const rec = DB.records[key];
    if (!rec || !rec.start) return;
    const day = getRecordDay(key, rec);
    lines.push([
      key, rec.start, rec.end || '未打卡',
      (day.workMin / 60).toFixed(2), (day.overtimeMin / 60).toFixed(2),
      day.subsidy, rec.source === 'manual' ? '日历补录' : '软件打卡'
    ].join(','));
  });
  return lines.join('\r\n');
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 300);
}

function flushSave() {
  clearTimeout(saveTimer);
  saveTimer = null;
  try {
    window.store.save(jsonText(), csvText());
  } catch (e) {
    console.error('flushSave failed', e);
  }
}

// 旧版本把记录存在软件内部存储里，首次使用（数据文件还不存在）时迁移到数据文件
// （旧的手动标记上/下半天/缺勤已废弃，不再迁移）
function migrateLegacyRecords() {
  const out = {};
  let count = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const sk = localStorage.key(i);
    if (!sk || !sk.startsWith('workday-')) continue;
    try {
      const parsed = JSON.parse(localStorage.getItem(sk));
      if (parsed && parsed.start) {
        out[sk.slice('workday-'.length)] = parsed;
        count++;
      }
    } catch (e) { /* 跳过损坏的旧记录 */ }
  }
  return { records: out, count };
}

async function loadData() {
  let data = null;
  try {
    data = await window.store.load();
  } catch (e) {
    console.error('loadData failed', e);
  }
  DB.records = (data && data.records) ? data.records : {};
  if (Object.keys(DB.records).length === 0) {
    const legacy = migrateLegacyRecords();
    if (legacy.count > 0) {
      DB.records = legacy.records;
      flushSave();   // 迁移结果立即写文件，不只留在内存
    }
  }
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

// 日历/记录列表当前浏览的年月（月度翻页用，默认当前月）
let viewY = new Date().getFullYear();
let viewM = new Date().getMonth();

// 是否正在浏览当前月
function isCurMonth() {
  const n = new Date();
  return viewY === n.getFullYear() && viewM === n.getMonth();
}

// 当前月的标识（用于检测跨月）
function curMonthKey() {
  const n = new Date();
  return `${n.getFullYear()}-${n.getMonth()}`;
}

let lastCurMonthKey = curMonthKey();

// 将过往日期未结算的记录自动按当日 23:59 结算，并固化快照数据（无需手动打卡）
// 历史月份记录永久保留，供日历月度翻页回看
function finalizePastRecords() {
  const today = dateKey(new Date());
  let changed = false;
  Object.keys(DB.records).forEach((key) => {
    const rec = DB.records[key];
    if (key < today && rec && !rec.end && rec.start) {
      rec.end = '23:59';
      const day = calcDay(startMsOf(key, rec), endMsOf(key, rec));
      rec.workMin = Math.round(day.workMin * 100) / 100;
      rec.overtimeMin = Math.round(day.overtimeMin * 100) / 100;
      rec.subsidy = day.subsidy;
      changed = true;
    }
  });
  if (changed) scheduleSave();
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

function updateMonthLabels() {
  // 统计固定显示当前月；记录列表跟随日历翻页的浏览月份
  const n = new Date();
  $('stats-month').textContent = `（${n.getFullYear()}年${n.getMonth() + 1}月）`;
  $('records-month').textContent = `（${viewY}年${viewM + 1}月）`;
}

function renderStats() {
  const now = new Date();
  const y = now.getFullYear();
  const mo = now.getMonth();
  const daysInMonth = new Date(y, mo + 1, 0).getDate();
  const today = now.getDate();

  // 跨月累计：补贴与日均加班看全部历史月份（记录永久保留）
  let allDays = 0;
  let allOvertimeMin = 0;
  let allSubsidy = 0;
  Object.keys(DB.records).forEach((key) => {
    const rec = DB.records[key];
    if (!rec || !rec.start) return;
    const day = getRecordDay(key, rec);
    allDays++;
    allOvertimeMin += day.overtimeMin;
    allSubsidy += day.subsidy;
  });

  // 两个口径（共用“有记录即出勤”的定义）：
  // 「出勤天数」显示 = 已勤天数 / 本月按日历应勤总天数（含调休补班，不含节假日与周末，未来几天也计进去）
  // 「出勤率」计算 = 已过完工作日中有记录的天数 / 已过完的工作日天数（今天不计，避免刚打开软件就被扣分）
  // 没打开软件也没补录的日子：日历上显示空白，但仍计入分母，因此自然拉低出勤率
  let attended = 0;            // 已勤天数（含休息日加班）
  let monthShouldDays = 0;     // 本月按日历应出勤总天数
  let pastWorkdays = 0;        // 已过完的工作日天数
  let pastAttended = 0;        // 其中真正有打卡记录的天数
  let restOvertime = 0;        // 休息日还来上班的天数（只多算出勤，不进出勤率）

  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${y}-${pad(mo + 1)}-${pad(d)}`;
    const rec = getRecord(key);
    if (isWorkday(key)) {
      monthShouldDays++;
      if (rec) attended++;
      if (d < today) {
        pastWorkdays++;
        if (rec) pastAttended++;
      }
    } else if (rec) {
      // 休息日补录（如周末加班）：算一天出勤，应勤天数与出勤率都不变
      restOvertime++;
      attended++;
    }
  }

  const rate = pastWorkdays > 0 ? (pastAttended / pastWorkdays) * 100 : 100;
  const rateEl = $('s-rate');
  rateEl.textContent = rate.toFixed(1) + '%';
  rateEl.classList.toggle('rate-red', rate > 90);
  rateEl.classList.toggle('rate-blue', rate <= 90);

  $('s-attend').textContent = `${attended} / ${monthShouldDays} 天`;
  $('s-attend').title = restOvertime > 0
    ? `本月按日历应出勤 ${monthShouldDays} 天，其中休息日还来上班 ${restOvertime} 天（不计入出勤率）`
    : '';
  $('s-subsidy').textContent = allSubsidy > 0 ? `¥${allSubsidy}` : '¥0';
  $('s-avg-ot').textContent =
    allDays > 0 && allOvertimeMin > 0 ? fmtDuration(allOvertimeMin / allDays) : '0小时00分';
}

// 记录列表：跟随日历翻页的浏览月份（viewY/viewM），倒序展示
function renderRecordList() {
  const daysInMonth = new Date(viewY, viewM + 1, 0).getDate();
  const records = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${viewY}-${pad(viewM + 1)}-${pad(d)}`;
    const rec = getRecord(key);
    if (rec) {
      records.push({ key, d, rec, day: getRecordDay(key, rec) });
    }
  }

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
      dateSpan.textContent = `${pad(viewM + 1)}-${pad(item.d)}`;

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
          if (calPopKey === item.key) refreshAfterChange();
          else renderAll();
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
  renderCalendar();
  renderRecordList();
  updateMonthLabels();
}

/* ================= 出勤日历 ================= */
function renderCalendar() {
  const now = new Date();
  const y = viewY;
  const mo = viewM;
  const curMonth = isCurMonth();
  const daysInMonth = new Date(y, mo + 1, 0).getDate();
  const firstWeekday = (new Date(y, mo, 1).getDay() + 6) % 7; // 周一=0

  $('cal-title').textContent = `${y}年${mo + 1}月 出勤日历`;
  $('cal-month-hint').textContent = curMonth ? '' : '（历史月份 · 可补录）';
  // 已是当前月时禁止往后翻
  $('cal-next').disabled = curMonth;
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
    const workday = isWorkday(key);

    const cell = document.createElement('div');
    cell.className = 'cal-cell';
    cell.dataset.key = key;
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

    if (rec) {
      cell.classList.add('present');
      // 补录的记录加一圈深色内边，与当天在软件里打卡区分
      if (rec.source === 'manual') cell.classList.add('manual-src');
      if (!rec.end) cell.classList.add('pending');
    } else if (curMonth && workday && d >= now.getDate()) {
      cell.classList.add('future');       // 还没到的工作日：不用填
    } else {
      cell.classList.add('no-rec');       // 没填的日子：空白，不涂灰判缺勤
    }

    if (curMonth && d === now.getDate()) cell.classList.add('today');

    // 点击日期弹出浮层：已有记录看详情，过去的空白日可补录
    cell.addEventListener('click', (e) => {
      e.stopPropagation();
      if (calPopKey === key && !$('cal-pop').classList.contains('hidden')) {
        closeCalPop();
        return;
      }
      openCalPop(key, cell);
    });

    grid.appendChild(cell);
  }
}

function openCalendar() {
  // 每次打开回到当前月
  const n = new Date();
  viewY = n.getFullYear();
  viewM = n.getMonth();
  renderCalendar();
  renderRecordList();
  updateMonthLabels();
  $('calendar-overlay').classList.remove('hidden');
}

function closeCalendar() {
  $('calendar-overlay').classList.add('hidden');
  closeCalPop();
}

// 月度翻页：向左任意翻，向右不超过当前月
function gotoPrevMonth() {
  closeCalPop();
  viewM--;
  if (viewM < 0) { viewM = 11; viewY--; }
  renderCalendar();
  renderRecordList();
  updateMonthLabels();
}

function gotoNextMonth() {
  const n = new Date();
  const ty = viewM === 11 ? viewY + 1 : viewY;
  const tm = viewM === 11 ? 0 : viewM + 1;
  if (ty > n.getFullYear() || (ty === n.getFullYear() && tm > n.getMonth())) return;
  closeCalPop();
  viewY = ty;
  viewM = tm;
  renderCalendar();
  renderRecordList();
  updateMonthLabels();
}

/* ================= 日历浮层：已填日期看详情，过去的空白日可补录 ================= */
let calPopKey = null;

function fmtKeyCn(key) {
  const [y, mo, d] = key.split('-').map(Number);
  return `${y}年${mo}月${d}日`;
}

function openCalPop(key, cell) {
  calPopKey = key;
  renderCalPop();
  $('cal-pop').classList.remove('hidden');
  positionCalPop(key);
}

function positionCalPop(key) {
  const pop = $('cal-pop');
  const cell = $('cal-grid').querySelector(`.cal-cell[data-key="${key}"]`);
  if (!cell) return;
  const oRect = $('calendar-overlay').getBoundingClientRect();
  const cRect = cell.getBoundingClientRect();
  let left = cRect.left - oRect.left + cRect.width / 2 - pop.offsetWidth / 2;
  left = Math.max(8, Math.min(left, oRect.width - pop.offsetWidth - 8));
  let top = cRect.top - oRect.top - pop.offsetHeight - 4;
  if (top < 4) top = cRect.bottom - oRect.top + 4;
  pop.style.left = `${left}px`;
  pop.style.top = `${Math.max(4, Math.min(top, oRect.height - pop.offsetHeight - 8))}px`;
}

// 根据该日状态切换浮层形态：详情态 / 录入态 / 不可填提示
function renderCalPop() {
  const key = calPopKey;
  if (!key) return;
  const rec = getRecord(key);
  const todayKey = dateKey(new Date());
  const canInput = !rec && key < todayKey;

  $('cal-pop-title').textContent = fmtKeyCn(key) + (rec ? '' : canInput ? ' · 补录出勤' : '');
  $('cal-pop-detail').classList.toggle('hidden', !rec);
  $('cal-pop-form').classList.toggle('hidden', !canInput);
  $('cal-pop-locked').classList.toggle('hidden', !!rec || canInput);

  if (rec) {
    const day = getRecordDay(key, rec);
    $('cp-start').textContent = rec.start || '--';
    $('cp-end').textContent = rec.end || '未打卡（下班时间还在累加）';
    $('cp-work').textContent = fmtDuration(day.workMin);
    $('cp-ot').textContent = fmtDuration(day.overtimeMin);
    $('cp-sub').textContent = day.subsidy > 0 ? `¥${day.subsidy}` : '暂无补贴';
    $('cp-source').textContent = rec.source === 'manual'
      ? '这条是在日历里补录的'
      : (!rec.auto && rec.end === '23:59' ? '这条由软件自动按 23:59 结算' : '这条是在软件里打卡生成的');
  } else if (canInput) {
    ['cp-in-sh', 'cp-in-sm', 'cp-in-eh', 'cp-in-em'].forEach((id) => { $(id).value = ''; });
    showPopError('');
  }
}

function closeCalPop() {
  $('cal-pop').classList.add('hidden');
  calPopKey = null;
}

function showPopError(msg) {
  const err = $('cp-err');
  err.textContent = msg;
  err.classList.toggle('hidden', !msg);
}

// 改完记录后刷新日历/统计/列表，并让浮层跟着变形态
function refreshAfterChange() {
  const keepKey = calPopKey;
  renderCalendar();
  renderStats();
  renderRecordList();
  updateMonthLabels();
  if (keepKey) {
    calPopKey = keepKey;
    renderCalPop();
    positionCalPop(keepKey);
  }
}

function readPopHm(hId, mId, label) {
  const h = parseInt($(hId).value, 10);
  const m = parseInt($(mId).value, 10);
  if (!Number.isInteger(h) || h < 0 || h > 23) return { err: `请填入正确的${label}时间（时：0 - 23）` };
  if (!Number.isInteger(m) || m < 0 || m > 59) return { err: `请填入正确的${label}时间（分：0 - 59）` };
  return { h, m };
}

// 补录：填入上下班时间，工时/加班/补贴按与主界面相同的算法自动算出
function saveManualRecord() {
  const key = calPopKey;
  if (!key) return;
  const s = readPopHm('cp-in-sh', 'cp-in-sm', '上班');
  if (s.err) { showPopError(s.err); return; }
  const e = readPopHm('cp-in-eh', 'cp-in-em', '下班');
  if (e.err) { showPopError(e.err); return; }

  const [y, mo, d] = key.split('-').map(Number);
  const startMs = new Date(y, mo - 1, d, s.h, s.m).getTime();
  const endMs = new Date(y, mo - 1, d, e.h, e.m).getTime();
  if (endMs <= startMs) {
    showPopError('下班时间要晚于上班时间（暂不支持跨零点夜班）');
    return;
  }
  const day = calcDay(startMs, endMs);
  setRecord(key, {
    start: `${pad(s.h)}:${pad(s.m)}`,
    end: `${pad(e.h)}:${pad(e.m)}`,
    workMin: Math.round(day.workMin * 100) / 100,
    overtimeMin: Math.round(day.overtimeMin * 100) / 100,
    subsidy: day.subsidy,
    source: 'manual'
  });
  showPopError('');
  refreshAfterChange();
}

// 清空当日记录：浮层会立即切回录入态，可以直接重新填时间
function clearDayRecord() {
  const key = calPopKey;
  if (!key) return;
  if (!confirm(`确定清空 ${fmtKeyCn(key)} 的出勤记录吗？清空后这天变为空白，可以重新填上下班时间。`)) return;
  delRecord(key);
  if (key === dateKey(new Date())) {
    lastDismissTime = 0;
    lastTriggerTarget = 0;
    renderViews();
  }
  refreshAfterChange();
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
  $('cal-prev').addEventListener('click', gotoPrevMonth);
  $('cal-next').addEventListener('click', gotoNextMonth);
  $('calendar-overlay').addEventListener('click', (e) => {
    // 点浮层以外的任意位置先收起浮层；点到空白遮罩层再关闭整个日历
    if (!$('cal-pop').classList.contains('hidden')) {
      closeCalPop();
      return;
    }
    if (e.target === $('calendar-overlay')) closeCalendar();
  });

  // 日历浮层：补录保存 / 清空，浮层内部点击不冒泡到遮罩（避免误关闭）
  const calPop = $('cal-pop');
  calPop.addEventListener('click', (e) => e.stopPropagation());
  $('cal-pop-save').addEventListener('click', saveManualRecord);
  $('cal-pop-clear').addEventListener('click', clearDayRecord);
  ['cp-in-sh', 'cp-in-sm', 'cp-in-eh', 'cp-in-em'].forEach((id) => {
    $(id).addEventListener('input', () => showPopError(''));
  });

  // 数据文件入口
  $('btn-open-data').addEventListener('click', () => window.store.openFolder());
  $('btn-export-csv').addEventListener('click', async () => {
    flushSave();
    let p = '';
    try { p = await window.store.dataPath(); } catch (e) { /* ignore */ }
    alert(`已保存。你的出勤数据在这个文件里：\n${p}\n\n同目录下还有一份同名的「出勤记录.csv」，可以用 Excel 直接打开。`);
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
(async function boot() {
  await loadData();          // 从 文档/下班计时器/出勤记录.json 读数据（首次会迁移旧记录）
  finalizePastRecords();
  bindEvents();
  renderAll();
  tick();
  setInterval(tick, 1000);
  // 每分钟刷新一次统计（跨天自动结算、当天补贴实时计入）
  setInterval(() => {
    finalizePastRecords();
    // 跨月时自动回到新的当月，避免停在已结束的月份上
    if (curMonthKey() !== lastCurMonthKey) {
      lastCurMonthKey = curMonthKey();
      const n = new Date();
      viewY = n.getFullYear();
      viewM = n.getMonth();
      renderCalendar();
      renderRecordList();
      if (calPopKey) closeCalPop();
    }
    renderStats();
    updateMonthLabels();
  }, 60000);

  // 窗口关闭前把防抖中的最后一笔改动同步写入文件
  window.addEventListener('beforeunload', () => {
    try {
      window.store.saveSync(jsonText(), csvText());
    } catch (e) { /* ignore */ }
  });
})();
