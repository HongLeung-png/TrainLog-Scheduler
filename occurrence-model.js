/* ═══════════════════════════════════════════════════════════════
   occurrence-model.js · 有效发生次（Effective Occurrence）

   这份文件在 Android 主程序（TrainLog）与独立网页课表
   （TrainLog-Scheduler）各有一份，内容必须保持一致。
   改这里时请同步另一端，否则两端对"哪节课在哪天"的判断会不一致。

   解决的问题
   ──────────
   固定课的「某一次」在数据里并不存在独立记录：它由
   `trainlog_schedules`(course_kind='fixed', weekday=N) 每周重复生成。
   单次改期只往例外表写一条 status='moved' + 目标时间。

   于是「这门课在某一天到底上不上、几点上」不能用单条记录判断，
   必须由一个统一函数推导。所有读路径（课表、统计、冲突、AI、内容）
   都从这里取，避免各写一套导致数字对不上。

   两个日期必须分开
   ────────────────
   occurrenceDate（数据日期）  训练内容、考勤、训练记录都按它定位。
                               改期不改变它 —— 这条 occurrence 还是同一次课。
   effectiveDate  （展示日期） 它实际发生在哪一天，用于排入课表、统计课次。
                               改期后等于目标日期。

   这个分离是「改期后内容不丢、历史不被重写」的前提：
   内容永远挂在原始 occurrence 上，不会因为挪了日期而变成孤儿。
   ═══════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  /* ── 日期 ─────────────────────────────────────────────────── */

  /* 用 UTC 计算星期，避免本地时区在午夜前后把日期算错一天 */
  function weekdayOf(dateStr) {
    const parts = String(dateStr || '').split('-').map(Number);
    if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return 0;
    const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    const wd = d.getUTCDay();
    return wd === 0 ? 7 : wd;
  }

  function toMinutes(t) {
    const parts = String(t || '00:00').split(':').map(Number);
    return (parts[0] || 0) * 60 + (parts[1] || 0);
  }

  function overlaps(a, b) {
    return toMinutes(a.startTime) < toMinutes(b.endTime)
        && toMinutes(a.endTime)   > toMinutes(b.startTime);
  }

  /* ── 例外归一化 ───────────────────────────────────────────
     云端列名是 snake_case，本地是 camelCase，早期版本还缺 moved 列。
     在这里统一，后面所有逻辑只认一种形状。 */
  function normalizeException(e) {
    if (!e) return null;
    return {
      id: e.id || '',
      scheduleId: String(e.scheduleId || e.schedule_id || ''),
      date: String(e.date || e.occurrence_date || ''),
      status: String(e.status || ''),
      movedToDate: String(e.movedToDate || e.moved_to_date || ''),
      movedToStart: String(e.movedToStart || e.moved_to_start || ''),
      movedToEnd: String(e.movedToEnd || e.moved_to_end || '')
    };
  }

  function kindOf(s) {
    return s && s.kind === 'temporary' ? 'temporary' : 'fixed';
  }

  /* 身份键用「课程 + 原始日期」，不用展示日期。
     同一门每周固定课可以在同一天有两个合法出现次：
     它自己那天的那一节，加上从别处改期过来的一节（时间不重叠时）。
     用展示日期做键会把它们合并成一条，等于悄悄吞掉一节课。 */
  function occurrenceKey(scheduleId, occurrenceDate) {
    return String(scheduleId) + '|' + String(occurrenceDate);
  }

  /* ── 核心：推导某一天的有效发生次 ───────────────────────── */

  function expand(opts) {
    const date = String((opts && opts.date) || '');
    const schedules = (opts && opts.schedules) || [];
    const exceptions = ((opts && opts.exceptions) || []).map(normalizeException).filter(Boolean);
    if (!date) return [];

    const wd = weekdayOf(date);

    /* 这一天的例外，按 scheduleId 索引 */
    const exceptionToday = new Map();
    for (const e of exceptions) {
      if (e.date === date) exceptionToday.set(e.scheduleId, e);
    }

    const out = [];
    const seen = new Set();

    const push = (item) => {
      const key = occurrenceKey(item.id, item.occurrenceDate);
      if (seen.has(key)) return;
      seen.add(key);
      out.push(item);
    };

    /* 1. 原始的当天课程（固定课按星期匹配，临时课按日期匹配） */
    for (const s of schedules) {
      const kind = kindOf(s);
      const matches = kind === 'fixed'
        ? Number(s.day) === wd
        : String(s.date || '') === date;
      if (!matches) continue;

      const ex = exceptionToday.get(String(s.id));
      const status = ex ? ex.status : '';

      /* cancelled 与 moved 都不在原日期出现：前者取消，后者已经挪走 */
      if (status === 'cancelled' || status === 'moved') continue;

      push({
        ...s,
        kind: kind,
        occurrenceDate: date,
        effectiveDate: date,
        attendanceStatus: status,
        movedFromDate: '',
        movedToDate: '',
        movedFromTime: '',
        movedToTime: ''
      });
    }

    /* 2. 被改期到这一天的课程 */
    for (const ex of exceptions) {
      if (ex.status !== 'moved') continue;
      if (ex.movedToDate !== date) continue;

      const src = schedules.find(s => String(s.id) === ex.scheduleId);
      if (!src) continue;                 /* 原课程已删除：不显示孤儿记录 */
      if (kindOf(src) !== 'fixed') continue;  /* moved 只用于固定课 */

      const start = ex.movedToStart || src.startTime;
      const end = ex.movedToEnd || src.endTime;

      push({
        ...src,
        kind: 'fixed',
        startTime: start,
        endTime: end,
        occurrenceDate: ex.date,          /* 数据仍归原始日期 */
        effectiveDate: date,
        attendanceStatus: 'moved',
        movedFromDate: ex.date,
        movedToDate: date,
        movedFromTime: src.startTime,
        movedToTime: start,
        movedTimeChanged: ex.date === date
      });
    }

    return out.sort((a, b) => {
      const d = toMinutes(a.startTime) - toMinutes(b.startTime);
      return d !== 0 ? d : String(a.id).localeCompare(String(b.id));
    });
  }

  /* ── 数据日期：内容 / 考勤 / 训练记录都认这个 ───────────── */
  function contentDateFor(occurrence, fallback) {
    if (occurrence && occurrence.occurrenceDate) return occurrence.occurrenceDate;
    return String(fallback || '');
  }

  /* ── 冲突判定 ─────────────────────────────────────────────
     与旧 findScheduleConflict 的差异只有一处：
     临时课的比对改为基于当天有效发生次，因而
       · 已改期离开这一天的固定课不再误报冲突
       · 被改期到这一天的固定课会正确参与冲突
     固定课之间仍按星期模式比较 —— 单次改期不改变每周规则。 */
  function findConflict(opts) {
    const c = opts || {};
    const kind = c.kind === 'temporary' ? 'temporary' : 'fixed';
    const ignoreId = String(c.ignoreId || '');
    const schedules = c.schedules || [];
    const exceptions = c.exceptions || [];

    const candidate = {
      kind: kind,
      day: Number(c.day) || 0,
      date: String(c.date || ''),
      startTime: c.startTime,
      endTime: c.endTime
    };

    if (kind === 'temporary') {
      if (!candidate.date) return null;
      const dayOccurrences = expand({ date: candidate.date, schedules: schedules, exceptions: exceptions });
      for (const o of dayOccurrences) {
        if (ignoreId && String(o.id) === ignoreId) continue;
        if (overlaps(candidate, o)) return o;
      }
      return null;
    }

    /* 固定课：与同星期的其他固定课比模式；
       与未来的临时课比 —— 临时课落在该星期几就会被挤到 */
    for (const s of schedules) {
      if (ignoreId && String(s.id) === ignoreId) continue;
      const ok = kindOf(s);

      if (ok === 'fixed') {
        if (Number(s.day) !== candidate.day) continue;
        if (overlaps(candidate, s)) return s;
        continue;
      }

      if (!s.date) continue;
      if (weekdayOf(s.date) !== candidate.day) continue;
      if (String(s.date) < String(c.today || '')) continue;
      if (overlaps(candidate, s)) return s;
    }
    return null;
  }

  /* ── 统计：按有效发生次计数，避免原日期与新日期双计 ─────── */
  function countBetween(fromDate, toDate, opts) {
    const schedules = (opts && opts.schedules) || [];
    const exceptions = (opts && opts.exceptions) || [];
    const from = String(fromDate || '');
    const to = String(toDate || '');
    if (!from || !to || from > to) return 0;

    let n = 0;
    let cursor = from;
    let guard = 0;
    while (cursor <= to && guard < 400) {
      n += expand({ date: cursor, schedules: schedules, exceptions: exceptions }).length;
      cursor = shift(cursor, 1);
      guard++;
    }
    return n;
  }

  function shift(dateStr, days) {
    const parts = String(dateStr).split('-').map(Number);
    const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    d.setUTCDate(d.getUTCDate() + (days || 0));
    return d.toISOString().slice(0, 10);
  }

  /* ── 状态机：合法转换 ─────────────────────────────────────
     一条 occurrence 只能处于一种终态，靠唯一约束保证物理互斥。
     这里给出业务层的判定，供 UI 与工具在动作前拦截。 */
  const TRANSITIONS = {
    '':        ['leave', 'cancelled', 'moved'],
    'leave':   ['', 'moved'],
    'cancelled': ['', 'moved'],
    'moved':   ['', 'moved']
  };

  function canTransition(from, to) {
    const key = String(from || '');
    const allowed = TRANSITIONS[key];
    if (!allowed) return false;
    return allowed.indexOf(String(to || '')) >= 0;
  }

  function describe(occurrence) {
    if (!occurrence) return '';
    if (occurrence.attendanceStatus === 'moved') {
      if (occurrence.movedFromDate === occurrence.effectiveDate) {
        return '时间已调整（原 ' + occurrence.movedFromTime + '）';
      }
      return '由 ' + occurrence.movedFromDate + ' 改期';
    }
    if (occurrence.attendanceStatus === 'leave') return '已请假';
    if (occurrence.attendanceStatus === 'cancelled') return '已取消';
    return '';
  }

  global.TrainLogOccurrence = {
    weekdayOf: weekdayOf,
    toMinutes: toMinutes,
    shift: shift,
    overlaps: overlaps,
    kindOf: kindOf,
    normalizeException: normalizeException,
    occurrenceKey: occurrenceKey,
    expand: expand,
    contentDateFor: contentDateFor,
    findConflict: findConflict,
    countBetween: countBetween,
    canTransition: canTransition,
    describe: describe,
    TRANSITIONS: TRANSITIONS
  };
})(typeof window !== 'undefined' ? window : globalThis);
