const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

/* 直接跑真实的 cloud-schedule.js，用假 fetch 模拟三种响应：
   1. 老库：带 moved 列 → 400 column does not exist（生产库当前就是这个）
   2. 新库：带 moved 列 → 200
   3. 网络故障 → 不该被当成"没有 moved 列"

   这三条正是生产上线前必须成立的兼容契约。 */

const SRC = fs.readFileSync(path.join(__dirname, '..', 'cloud-schedule.js'), 'utf8');

/* fetch 可替换：用来验证"失败后不会把能力锁死" */
function load(fetchImpl) {
  const state = { impl: fetchImpl, calls: 0 };
  const ctx = {
    window: {},
    console,
    fetch: (...args) => { state.calls++; return state.impl(...args); }
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return { cloud: ctx.window.TrainLogCloud, state };
}

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Bad Request',
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body))
  };
}

const ROW_BASE = {
  id: 'e1', schedule_id: 'f1', occurrence_date: '2026-10-26',
  status: 'moved', created_at: '', updated_at: ''
};
const ROW_MOVED = { ...ROW_BASE, moved_to_date: '2026-10-28', moved_to_start: '17:00:00', moved_to_end: '18:00:00' };

test('老库：带 moved 列返回 400 时回退到基础列，并记住能力关闭', async () => {
  const calls = [];
  const { cloud } = load(async (url) => {
    calls.push(String(url));
    if (String(url).includes('moved_to_date')) {
      return response(400, { code: '42703', message: 'column trainlog_schedule_exceptions.moved_to_date does not exist' });
    }
    return response(200, [ROW_BASE]);
  });

  const rows = await cloud.listExceptions();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'moved');
  assert.equal(rows[0].movedToDate, '', '老库上 moved 字段应为空串，不是 undefined');
  assert.equal(cloud.movedSchemaReady(), false);
  assert.equal(calls.length, 2, '应该只多发一次回退请求');

  /* 第二次调用不应再试探 moved 列 */
  await cloud.listExceptions();
  assert.equal(calls.length, 3, '能力已知后只请求基础列');
});

test('新库：带 moved 列返回 200 时正确映射目标时间', async () => {
  const { cloud } = load(async () => response(200, [ROW_MOVED]));
  const rows = await cloud.listExceptions();
  assert.equal(rows[0].movedToDate, '2026-10-28');
  assert.equal(rows[0].movedToStart, '17:00', '时间要截成 HH:mm');
  assert.equal(rows[0].movedToEnd, '18:00');
  assert.equal(cloud.movedSchemaReady(), true);
});

test('网络故障不能被当成"没有 moved 列"', async () => {
  const { cloud, state } = load(async () => { throw new Error('Failed to fetch'); });

  await assert.rejects(() => cloud.listExceptions(), /Failed to fetch/);
  assert.equal(state.calls, 1, '不应该在失败后再发一次回退请求');
  assert.equal(cloud.movedSchemaReady(), false, '未知状态对外表现为"未确认支持"（保守）');

  /* 关键：未知不能被锁死。网络恢复后仍应重新识别出 moved 列。 */
  state.impl = async () => response(200, [ROW_MOVED]);
  const rows = await cloud.listExceptions();
  assert.equal(rows[0].movedToDate, '2026-10-28', '网络恢复后应能读到 moved 数据');
  assert.equal(cloud.movedSchemaReady(), true, '不能因为一次网络故障就永久降级');
});

test('probeMovedSchema 在网络故障时返回 false（保守），恢复后能改口', async () => {
  const { cloud, state } = load(async () => { throw new Error('offline'); });

  assert.equal(await cloud.probeMovedSchema(), false, '探测失败按"不支持"处理，避免给出假预览');

  state.impl = async () => response(200, [ROW_MOVED]);
  assert.equal(await cloud.probeMovedSchema(), true, '重新探测应能得到真实结果');
});

test('撤销改期走 RPC，并把服务端返回原样透出', async () => {
  let seen = null;
  const { cloud } = load(async (url, opts) => {
    seen = { url: String(url), body: JSON.parse(opts.body) };
    return response(200, { ok: true, restored: true, already_restored: false });
  });
  const r = await cloud.undoMoveOccurrence('f1', '2026-10-26');
  assert.equal(r.ok, true);
  assert.equal(r.restored, true);
  assert.match(seen.url, /rpc\/trainlog_undo_move_atomic$/);
  assert.equal(seen.body.p_schedule_id, 'f1');
  assert.equal(seen.body.p_from_date, '2026-10-26');
});
