const WEEK = [
  { v: 1, s: '周一' },
  { v: 2, s: '周二' },
  { v: 3, s: '周三' },
  { v: 4, s: '周四' },
  { v: 5, s: '周五' },
  { v: 6, s: '周六' },
  { v: 7, s: '周日' }
];

const $ = id => document.getElementById(id);

let schedules = [];
let selected = today();

function today() {
  return dateStr(new Date());
}

function dateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parse(s) {
  const [a, b, c] = s.split('-').map(Number);
  return new Date(a, b - 1, c, 12);
}

function wd(s) {
  const n = parse(s).getDay();
  return n || 7;
}

function shift(s, n) {
  const d = parse(s);
  d.setDate(d.getDate() + n);
  return dateStr(d);
}

function week(s) {
  const d = parse(s);
  d.setDate(d.getDate() - (wd(s) - 1));

  return WEEK.map((w, i) => {
    const x = new Date(d);
    x.setDate(d.getDate() + i);

    return {
      ...w,
      date: dateStr(x),
      md: `${x.getMonth() + 1}/${x.getDate()}`
    };
  });
}

function kind(x) {
  return x.kind === 'temporary' ? 'temporary' : 'fixed';
}

function rows(date) {
  return schedules
    .filter(x =>
      kind(x) === 'fixed'
        ? Number(x.day) === wd(date)
        : x.date === date
    )
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
}

function esc(v) {
  const d = document.createElement('div');
  d.textContent = v ?? '';
  return d.innerHTML;
}

function card(x) {
  return `
    <button class="card course" data-id="${x.id}">
      <div class="time">
        <strong>${x.startTime}</strong>
        <small>${x.endTime}</small>
      </div>

      <div class="meta">
        <h3>${esc(x.studentName)}</h3>
        <p>
          ${esc(x.type || '常规训练')}
          ${x.notes ? ` · ${esc(x.notes)}` : ''}
        </p>
      </div>

      <span class="tag ${kind(x) === 'temporary' ? 'temp' : ''}">
        ${kind(x) === 'temporary' ? '临时约课' : '固定课'}
      </span>
    </button>
  `;
}

function render() {
  if ($('status')) {
    $('status').textContent = '共享课表 · 所有人打开网页均可编辑';
  }

  const days = week(selected);
  const rs = rows(selected);

  $('app').innerHTML = `
    <div class="weeknav">
      <button class="secondary" id="prev">
        ‹ 上一周
      </button>

      <div
        class="notice summary"
        style="margin:0;text-align:center"
      >
        ${days[0].date} — ${days[6].date}
      </div>

      <button class="secondary" id="now">
        本周
      </button>

      <button class="secondary" id="next">
        下一周 ›
      </button>
    </div>

    <div class="weekdays">
      ${days.map(d => `
        <button
          class="day ${d.date === selected ? 'active' : ''}"
          data-date="${d.date}"
        >
          <span>${d.s}</span>
          <small>
            ${d.md} · ${rows(d.date).length}节
          </small>
        </button>
      `).join('')}
    </div>

    <div class="list">
      ${
        rs.length
          ? rs.map(card).join('')
          : '<div class="empty">当天暂无课程</div>'
      }
    </div>
  `;

  $('prev').onclick = () => {
    selected = shift(selected, -7);
    render();
  };

  $('next').onclick = () => {
    selected = shift(selected, 7);
    render();
  };

  $('now').onclick = () => {
    selected = today();
    render();
  };

  document.querySelectorAll('.day').forEach(b => {
    b.onclick = () => {
      selected = b.dataset.date;
      render();
    };
  });

  document.querySelectorAll('.course').forEach(b => {
    b.onclick = () => {
      const item = schedules.find(x => x.id === b.dataset.id);
      if (item) openCourse(item);
    };
  });
}

function toggleFields() {
  $('fixedField').style.display =
    $('kind').value === 'fixed'
      ? ''
      : 'none';

  $('tempField').style.display =
    $('kind').value === 'temporary'
      ? ''
      : 'none';
}

function fillNames() {
  if (!$('studentNames')) return;

  $('studentNames').innerHTML =
    [...new Set(
      schedules
        .map(x => x.studentName)
        .filter(Boolean)
    )]
      .sort()
      .map(n =>
        `<option value="${esc(n)}">`
      )
      .join('');
}

function openCourse(x = null) {
  fillNames();

  $('courseTitle').textContent =
    x ? '编辑课程' : '安排课程';

  $('courseId').value =
    x?.id || '';

  $('kind').value =
    kind(x || {});

  $('studentName').value =
    x?.studentName || '';

  $('weekday').value =
    x?.day || wd(selected);

  $('courseDate').value =
    x?.date || selected;

  $('startTime').value =
    x?.startTime || '16:00';

  $('endTime').value =
    x?.endTime || '17:00';

  $('courseType').value =
    x?.type || '综合';

  $('notes').value =
    x?.notes || '';

  $('deleteBtn').classList.toggle(
    'hidden',
    !x
  );

  toggleFields();

  $('courseDialog').showModal();
}

async function load() {
  try {
    if ($('status')) {
      $('status').textContent = '正在同步课表...';
    }

    schedules =
      await TrainLogCloud.listSchedules();

    render();

  } catch (e) {
    console.error(e);

    if ($('status')) {
      $('status').textContent =
        '课表同步失败：' + e.message;
    }

    $('app').innerHTML = `
      <div class="empty">
        无法连接共享课表，请稍后刷新页面重试。
        <br><br>
        ${esc(e.message)}
      </div>
    `;
  }
}


// =======================
// 页面按钮
// =======================

$('kind').onchange =
  toggleFields;

$('addBtn').onclick = () =>
  openCourse();

$('cancelCourse').onclick = () =>
  $('courseDialog').close();


// =======================
// 隐藏旧版连接设置
// =======================

if ($('settingsBtn')) {
  $('settingsBtn').style.display = 'none';
}

if ($('loginDialog')) {
  $('loginDialog').style.display = 'none';
}


// =======================
// 保存课程
// =======================

$('courseForm').onsubmit =
  async e => {

    e.preventDefault();

    const x = {
      studentName:
        $('studentName').value.trim(),

      kind:
        $('kind').value,

      day:
        $('kind').value === 'fixed'
          ? Number($('weekday').value)
          : null,

      date:
        $('kind').value === 'temporary'
          ? $('courseDate').value
          : '',

      startTime:
        $('startTime').value,

      endTime:
        $('endTime').value,

      type:
        $('courseType').value,

      notes:
        $('notes').value.trim()
    };

    if (!x.studentName) {
      alert('请输入学员姓名');
      return;
    }

    if (!x.startTime || !x.endTime) {
      alert('请选择课程时间');
      return;
    }

    if (x.endTime <= x.startTime) {
      alert('结束时间需要晚于开始时间');
      return;
    }

    if (
      x.kind === 'temporary' &&
      !x.date
    ) {
      alert('临时约课需要选择日期');
      return;
    }

    try {

      const id =
        $('courseId').value;

      if (id) {

        await TrainLogCloud
          .updateSchedule(id, x);

      } else {

        await TrainLogCloud
          .createSchedule(x);
      }

      $('courseDialog').close();

      await load();

    } catch (err) {

      console.error(err);

      alert(
        '保存失败：' +
        err.message
      );
    }
  };


// =======================
// 删除课程
// =======================

$('deleteBtn').onclick =
  async () => {

    const id =
      $('courseId').value;

    if (!id) return;

    if (
      !confirm(
        '确定删除这节课程？'
      )
    ) {
      return;
    }

    try {

      await TrainLogCloud
        .deleteSchedule(id);

      $('courseDialog').close();

      await load();

    } catch (err) {

      console.error(err);

      alert(
        '删除失败：' +
        err.message
      );
    }
  };


// =======================
// 初始化星期选择
// =======================

$('weekday').innerHTML =
  WEEK.map(x =>
    `<option value="${x.v}">
      ${x.s}
    </option>`
  ).join('');


// =======================
// 页面启动
// =======================

load();
