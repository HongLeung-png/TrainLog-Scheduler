(() => {
  const CONFIG_KEY='trainlog_cloud_schedule_config_v1';
  const SESSION_KEY='trainlog_cloud_schedule_session_v1';
  const cleanUrl=v=>String(v||'').trim().replace(/\/+$/,'');
  const parse=(k,fallback={})=>{try{return JSON.parse(localStorage.getItem(k)||'')||fallback}catch{return fallback}};
  function getConfig(){return parse(CONFIG_KEY,{url:'',key:'',email:''});}
  function setConfig(cfg){const next={url:cleanUrl(cfg?.url),key:String(cfg?.key||'').trim(),email:String(cfg?.email||'').trim()};localStorage.setItem(CONFIG_KEY,JSON.stringify(next));return next;}
  function isConfigured(){const c=getConfig();return /^https:\/\//.test(c.url)&&!!c.key;}
  function getSession(){return parse(SESSION_KEY,null);}
  function hasSession(){const s=getSession();return !!(s?.access_token&&s?.refresh_token);}
  function setSession(s){ if(s)localStorage.setItem(SESSION_KEY,JSON.stringify(s)); else localStorage.removeItem(SESSION_KEY); }
  async function jsonFetch(url,opts={}){const r=await fetch(url,opts);const text=await r.text();let data=null;try{data=text?JSON.parse(text):null}catch{data=text}if(!r.ok){const msg=data?.msg||data?.message||data?.error_description||data?.error||`${r.status} ${r.statusText}`;throw new Error(msg)}return data;}
  async function signIn(email,password){const c=getConfig();if(!isConfigured())throw new Error('请先填写 Project URL 和 Publishable Key');if(!email||!password)throw new Error('请输入邮箱和密码');const data=await jsonFetch(`${c.url}/auth/v1/token?grant_type=password`,{method:'POST',headers:{apikey:c.key,'Content-Type':'application/json'},body:JSON.stringify({email,password})});setSession({...data,obtained_at:Date.now()});setConfig({...c,email});return data;}
  async function refreshSession(){const c=getConfig(),s=getSession();if(!s?.refresh_token)throw new Error('登录已失效，请重新登录');const data=await jsonFetch(`${c.url}/auth/v1/token?grant_type=refresh_token`,{method:'POST',headers:{apikey:c.key,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:s.refresh_token})});setSession({...data,obtained_at:Date.now()});return data;}
  async function accessToken(){let s=getSession();if(!s?.access_token)throw new Error('请先登录共享课表');const expires=(s.expires_in||3600)*1000, obtained=s.obtained_at||0;if(Date.now()>obtained+expires-120000){s=await refreshSession()}return s.access_token;}
  async function rest(path,opts={}){const c=getConfig();if(!isConfigured())throw new Error('共享课表尚未配置');const token=await accessToken();return jsonFetch(`${c.url}/rest/v1/${path}`,{...opts,headers:{apikey:c.key,Authorization:`Bearer ${token}`,'Content-Type':'application/json',...(opts.headers||{})}});}
  const mapRow=r=>({id:r.id,studentName:r.student_name||'',kind:r.course_kind==='temporary'?'temporary':'fixed',day:r.weekday==null?null:Number(r.weekday),date:r.course_date||'',startTime:String(r.start_time||'').slice(0,5),endTime:String(r.end_time||'').slice(0,5),type:r.course_type||'',notes:r.notes||'',createdAt:r.created_at||'',updatedAt:r.updated_at||'',source:'cloud'});
  const toRow=x=>({student_name:String(x.studentName||'').trim(),course_kind:x.kind==='temporary'?'temporary':'fixed',weekday:x.kind==='temporary'?null:Number(x.day),course_date:x.kind==='temporary'?x.date:null,start_time:x.startTime,end_time:x.endTime,course_type:x.type||'',notes:x.notes||'',updated_at:new Date().toISOString()});
  async function listSchedules(){const rows=await rest('trainlog_schedules?select=id,student_name,course_kind,weekday,course_date,start_time,end_time,course_type,notes,created_at,updated_at&order=start_time.asc');return (rows||[]).map(mapRow);}
  async function createSchedule(x){const rows=await rest('trainlog_schedules?select=*',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify(toRow(x))});return mapRow(rows[0]);}
  async function updateSchedule(id,x){const rows=await rest(`trainlog_schedules?id=eq.${encodeURIComponent(id)}&select=*`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify(toRow(x))});return mapRow(rows[0]);}
  async function deleteSchedule(id){await rest(`trainlog_schedules?id=eq.${encodeURIComponent(id)}`,{method:'DELETE',headers:{Prefer:'return=minimal'}});return true;}
  async function signOut(){setSession(null);}
  window.TrainLogCloud={getConfig,setConfig,isConfigured,getSession,hasSession,signIn,signOut,listSchedules,createSchedule,updateSchedule,deleteSchedule};
})();
