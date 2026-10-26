const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

/* occurrence-model.js 在 Android 主程序与这个网页课表各有一份。
   这里验证网页端依赖的那部分契约，并检查两份副本的**代码正文**是否一致
   （注释允许不同，注释里写了同步要求）。

   只跑 Node，不需要浏览器：这个文件是纯函数，没有 DOM 依赖。 */

const MODEL_PATH = path.join(__dirname, '..', 'occurrence-model.js');
const ANDROID_PATH = path.join(
  __dirname, '..', '..', 'TrainLog',
  'app', 'src', 'main', 'assets', 'www', 'occurrence-model.js'
);

const SRC = fs.readFileSync(MODEL_PATH, 'utf8');

function load() {
  const ctx = { window: {}, console };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return ctx.window.TrainLogOccurrence;
}

const M = load();

/* fixture：2026-10-26 周一，2026-10-28 周三 */
function fixture(exceptions = []) {
  return {
    schedules: [
      { id: 'f1', kind: 'fixed', day: 1, startTime: '16:00', endTime: '17:00', studentName: '陈一诺' },
      { id: 'f2', kind: 'fixed', day: 3, startTime: '10:00', endTime: '11:00', studentName: '林思远' },
      { id: 't1', kind: 'temporary', day: null, date: '2026-10-28', startTime: '14:00', endTime: '15:00', studentName: '林思远' }
    ],
    exceptions
  };
}

function movedTo(id, from, to, start, end) {
  return { scheduleId: id, date: from, status: 'moved', movedToDate: to, movedToStart: start, movedToEnd: end };
}

const on = (date, fx) => M.expand({ date, schedules: fx.schedules, exceptions: fx.exceptions });

test('改期后原日期不再出现', () => {
  const fx = fixture([movedTo('f1', '2026-10-26', '2026-10-28', '17:00', '18:00')]);
  assert.equal(on('2026-10-26', fx).length, 0);
});

test('改期后目标日期出现，时间用目标值', () => {
  const fx = fixture([movedTo('f1', '2026-10-26', '2026-10-28', '17:00', '18:00')]);
  const moved = on('2026-10-28', fx).find(x => x.id === 'f1');
  assert.ok(moved, '目标日期应有这节课');
  assert.equal(moved.startTime, '17:00');
  assert.equal(moved.endTime, '18:00');
});

test('数据日期留在原始日，展示日期是目标日', () => {
  const fx = fixture([movedTo('f1', '2026-10-26', '2026-10-28', '17:00', '18:00')]);
  const moved = on('2026-10-28', fx).find(x => x.id === 'f1');
  assert.equal(moved.occurrenceDate, '2026-10-26', '内容按它定位');
  assert.equal(moved.effectiveDate, '2026-10-28', '课表按它排布');
});

test('其他周的同一节课不受影响', () => {
  const fx = fixture([movedTo('f1', '2026-10-26', '2026-10-28', '17:00', '18:00')]);
  const next = on('2026-11-02', fx);
  assert.equal(next.length, 1);
  assert.equal(next[0].startTime, '16:00');
});

test('同一天只改时间：只出现一次', () => {
  const fx = fixture([movedTo('f1', '2026-10-26', '2026-10-26', '18:00', '19:00')]);
  const day = on('2026-10-26', fx);
  assert.equal(day.length, 1);
  assert.equal(day[0].startTime, '18:00');
});

test('周课次按有效发生日统计，改期前后不双计', () => {
  const before = M.countBetween('2026-10-26', '2026-11-01', fixture());
  const after = M.countBetween('2026-10-26', '2026-11-01',
    fixture([movedTo('f1', '2026-10-26', '2026-10-28', '17:00', '18:00')]));
  assert.equal(before, 3);
  assert.equal(after, 3);
});

test('冲突：原时段让出、目标时段占用', () => {
  const fx = fixture([movedTo('f1', '2026-10-26', '2026-10-28', '17:00', '18:00')]);
  const atSource = M.findConflict({
    kind: 'temporary', date: '2026-10-26', startTime: '16:30', endTime: '17:30',
    schedules: fx.schedules, exceptions: fx.exceptions
  });
  assert.equal(atSource, null);
  const atTarget = M.findConflict({
    kind: 'temporary', date: '2026-10-28', startTime: '17:30', endTime: '18:30',
    schedules: fx.schedules, exceptions: fx.exceptions
  });
  assert.equal(atTarget.id, 'f1');
});

test('撤销改期后回到原始安排', () => {
  assert.equal(on('2026-10-26', fixture([movedTo('f1', '2026-10-26', '2026-10-28', '17:00', '18:00')])).length, 0);
  assert.equal(on('2026-10-26', fixture()).length, 1);
});

test('请假保留、取消不出现、moved 优先于请假', () => {
  assert.equal(on('2026-10-26', fixture([{ scheduleId: 'f1', date: '2026-10-26', status: 'leave' }]))[0].attendanceStatus, 'leave');
  assert.equal(on('2026-10-26', fixture([{ scheduleId: 'f1', date: '2026-10-26', status: 'cancelled' }])).length, 0);
  const moved = on('2026-10-28', fixture([movedTo('f1', '2026-10-26', '2026-10-28', '17:00', '18:00')])).find(x => x.id === 'f1');
  assert.equal(moved.attendanceStatus, 'moved');
});

test('老库没有 moved 列时字段归一化为空串', () => {
  const n = M.normalizeException({ schedule_id: 'f1', occurrence_date: '2026-10-26', status: 'leave' });
  assert.equal(n.movedToDate, '');
  assert.equal(n.scheduleId, 'f1');
});

/* ── 两份副本是否同步 ─────────────────────────────────────
   只比代码正文（从 IIFE 开始），注释可以不同。
   Android 仓库不在本机时跳过，不让测试变成本地路径依赖。 */
test('与 Android 端的副本代码一致', { skip: !fs.existsSync(ANDROID_PATH) }, () => {
  const bodyOf = src => {
    const i = src.indexOf('(function (global) {');
    return i < 0 ? src.trim() : src.slice(i).replace(/\r\n/g, '\n').trim();
  };
  const other = fs.readFileSync(ANDROID_PATH, 'utf8');
  assert.equal(bodyOf(SRC), bodyOf(other), '两端的 occurrence-model.js 代码正文必须一致');
});
