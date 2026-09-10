(() => {
  // ===== TrainLog 公开共享课表配置 =====

  const SUPABASE_URL = 'https://znszkaeiaarjjlhkbxrg.supabase.co';

  // 把下面内容替换成你自己的完整 Publishable Key
  const SUPABASE_KEY = 'sb_publishable_这里换成你的完整KEY';


  const cleanUrl = v =>
    String(v || '').trim().replace(/\/+$/, '');

  // 保留这些接口，是为了兼容现有 schedule.js
  function getConfig() {
    return {
      url: SUPABASE_URL,
      key: SUPABASE_KEY,
      email: ''
    };
  }

  function setConfig() {
    return getConfig();
  }

  function isConfigured() {
    return (
      /^https:\/\//.test(SUPABASE_URL) &&
      SUPABASE_KEY.startsWith('sb_publishable_')
    );
  }

  // 公开课表不再需要登录
  function getSession() {
    return {
      public: true
    };
  }

  function hasSession() {
    return true;
  }

  // 为了兼容旧页面，即使 schedule.js 调用 signIn 也直接成功
  async function signIn() {
    return {
      public: true
    };
  }

  async function signOut() {
    return true;
  }

  async function jsonFetch(url, opts = {}) {
    const response = await fetch(url, opts);
    const text = await response.text();

    let data = null;

    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }

    if (!response.ok) {
      const msg =
        data?.msg ||
        data?.message ||
        data?.error_description ||
        data?.error ||
        `${response.status} ${response.statusText}`;

      throw new Error(msg);
    }

    return data;
  }

  async function rest(path, opts = {}) {
    if (!isConfigured()) {
      throw new Error('Supabase 配置无效');
    }

    return jsonFetch(
      `${cleanUrl(SUPABASE_URL)}/rest/v1/${path}`,
      {
        ...opts,
        headers: {
          apikey: SUPABASE_KEY,
          'Content-Type': 'application/json',
          ...(opts.headers || {})
        }
      }
    );
  }

  const mapRow = r => ({
    id: r.id,
    studentName: r.student_name || '',
    kind:
      r.course_kind === 'temporary'
        ? 'temporary'
        : 'fixed',
    day:
      r.weekday == null
        ? null
        : Number(r.weekday),
    date: r.course_date || '',
    startTime:
      String(r.start_time || '').slice(0, 5),
    endTime:
      String(r.end_time || '').slice(0, 5),
    type: r.course_type || '',
    notes: r.notes || '',
    createdAt: r.created_at || '',
    updatedAt: r.updated_at || '',
    source: 'cloud'
  });

  const toRow = x => ({
    student_name:
      String(x.studentName || '').trim(),

    course_kind:
      x.kind === 'temporary'
        ? 'temporary'
        : 'fixed',

    weekday:
      x.kind === 'temporary'
        ? null
        : Number(x.day),

    course_date:
      x.kind === 'temporary'
        ? x.date
        : null,

    start_time: x.startTime,
    end_time: x.endTime,

    course_type:
      x.type || '综合',

    notes:
      x.notes || '',

    updated_at:
      new Date().toISOString()
  });

  async function listSchedules() {
    const rows = await rest(
      'trainlog_schedules' +
      '?select=id,student_name,course_kind,weekday,course_date,start_time,end_time,course_type,notes,created_at,updated_at' +
      '&order=start_time.asc'
    );

    return (rows || []).map(mapRow);
  }

  async function createSchedule(x) {
    const rows = await rest(
      'trainlog_schedules?select=*',
      {
        method: 'POST',

        headers: {
          Prefer: 'return=representation'
        },

        body: JSON.stringify(toRow(x))
      }
    );

    return mapRow(rows[0]);
  }

  async function updateSchedule(id, x) {
    const rows = await rest(
      `trainlog_schedules?id=eq.${encodeURIComponent(id)}&select=*`,
      {
        method: 'PATCH',

        headers: {
          Prefer: 'return=representation'
        },

        body: JSON.stringify(toRow(x))
      }
    );

    return mapRow(rows[0]);
  }

  async function deleteSchedule(id) {
    await rest(
      `trainlog_schedules?id=eq.${encodeURIComponent(id)}`,
      {
        method: 'DELETE',

        headers: {
          Prefer: 'return=minimal'
        }
      }
    );

    return true;
  }

  window.TrainLogCloud = {
    getConfig,
    setConfig,
    isConfigured,
    getSession,
    hasSession,
    signIn,
    signOut,
    listSchedules,
    createSchedule,
    updateSchedule,
    deleteSchedule
  };
})();
