(() => {
  const SUPABASE_URL = 'https://znszkaeiaarjjlhkbxrg.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_kQLEoB0049qm_SmxbXpvZg_1u2o5FVv';
  const cleanUrl=v=>String(v||'').trim().replace(/\/+$/,'');
  function getConfig(){return {url:SUPABASE_URL,key:SUPABASE_KEY,email:''};}
  function setConfig(){return getConfig();}
  function isConfigured(){return /^https:\/\//.test(SUPABASE_URL)&&SUPABASE_KEY.startsWith('sb_publishable_');}
  function getSession(){return {public:true};}
  function hasSession(){return true;}
  async function signIn(){return {public:true};}
  async function signOut(){return true;}
  async function jsonFetch(url,opts={}){const r=await fetch(url,opts);const text=await r.text();let data=null;try{data=text?JSON.parse(text):null}catch{data=text}if(!r.ok){if(data?.code==='23505')throw new Error('数据重复，请刷新后重试。');const msg=data?.msg||data?.message||data?.error_description||data?.error||`${r.status} ${r.statusText}`;throw new Error(msg)}return data;}
  async function rest(path,opts={}){if(!isConfigured())throw new Error('Supabase 配置无效');return jsonFetch(`${cleanUrl(SUPABASE_URL)}/rest/v1/${path}`,{...opts,headers:{apikey:SUPABASE_KEY,'Content-Type':'application/json',...(opts.headers||{})}});}

  const mapSchedule=r=>({id:r.id,memberId:r.member_id||'',studentName:r.student_name||'',kind:r.course_kind==='temporary'?'temporary':'fixed',day:r.weekday==null?null:Number(r.weekday),date:r.course_date||'',startTime:String(r.start_time||'').slice(0,5),endTime:String(r.end_time||'').slice(0,5),type:r.course_type||'',notes:r.notes||'',createdAt:r.created_at||'',updatedAt:r.updated_at||'',source:'cloud'});
  const toSchedule=x=>({member_id:x.memberId||null,student_name:String(x.studentName||'').trim(),course_kind:x.kind==='temporary'?'temporary':'fixed',weekday:x.kind==='temporary'?null:Number(x.day),course_date:x.kind==='temporary'?x.date:null,start_time:x.startTime,end_time:x.endTime,course_type:x.type||'',notes:x.notes||'',updated_at:new Date().toISOString()});
  async function listSchedules(){const rows=await rest('trainlog_schedules?select=id,member_id,student_name,course_kind,weekday,course_date,start_time,end_time,course_type,notes,created_at,updated_at&order=start_time.asc');return (rows||[]).map(mapSchedule);}
  async function createSchedule(x){const rows=await rest('trainlog_schedules?select=*',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify(toSchedule(x))});return mapSchedule(rows[0]);}
  async function updateSchedule(id,x){const rows=await rest(`trainlog_schedules?id=eq.${encodeURIComponent(id)}&select=*`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify(toSchedule(x))});return mapSchedule(rows[0]);}
  async function deleteSchedule(id){await rest(`trainlog_schedules?id=eq.${encodeURIComponent(id)}`,{method:'DELETE',headers:{Prefer:'return=minimal'}});return true;}

  const mapException=r=>({id:r.id,scheduleId:r.schedule_id,date:r.occurrence_date||'',status:r.status||'',createdAt:r.created_at||'',updatedAt:r.updated_at||''});
  async function listExceptions(){const rows=await rest('trainlog_schedule_exceptions?select=id,schedule_id,occurrence_date,status,created_at,updated_at&order=occurrence_date.asc');return (rows||[]).map(mapException);}
  async function setScheduleException(scheduleId,date,status){const rows=await rest('trainlog_schedule_exceptions?on_conflict=schedule_id,occurrence_date&select=*',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=representation'},body:JSON.stringify({schedule_id:scheduleId,occurrence_date:date,status,updated_at:new Date().toISOString()})});return mapException(rows[0]);}
  async function deleteScheduleException(scheduleId,date){await rest(`trainlog_schedule_exceptions?schedule_id=eq.${encodeURIComponent(scheduleId)}&occurrence_date=eq.${encodeURIComponent(date)}`,{method:'DELETE',headers:{Prefer:'return=minimal'}});return true;}

  const mapMember=r=>({id:r.id,memberCode:r.member_code||'',name:r.name||'',alias:r.alias||'',sex:r.sex||'',birth:r.birth||'',goal:r.goal||'',contact:r.contact||'',notes:r.notes||'',createdAt:r.created_at||'',updatedAt:r.updated_at||''});
  const toMember=x=>{const row={name:String(x.name||'').trim(),alias:String(x.alias||'').trim(),sex:x.sex||'',birth:x.birth||null,goal:x.goal||'',contact:x.contact||'',notes:x.notes||'',updated_at:new Date().toISOString()};if(x.memberCode)row.member_code=String(x.memberCode).trim();return row;};
  async function listMembers(){const rows=await rest('trainlog_members?select=id,member_code,name,alias,sex,birth,goal,contact,notes,created_at,updated_at&order=member_code.asc');return (rows||[]).map(mapMember);}
  async function createMember(x){const rows=await rest('trainlog_members?select=*',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify(toMember(x))});return mapMember(rows[0]);}
  async function updateMember(id,x){const rows=await rest(`trainlog_members?id=eq.${encodeURIComponent(id)}&select=*`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify(toMember(x))});return mapMember(rows[0]);}
  async function updateMemberByCode(code,x){const rows=await rest(`trainlog_members?member_code=eq.${encodeURIComponent(code)}&select=*`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify(toMember({...x,memberCode:code}))});return rows?.[0]?mapMember(rows[0]):null;}
  async function deleteMember(id){await rest(`trainlog_members?id=eq.${encodeURIComponent(id)}`,{method:'DELETE',headers:{Prefer:'return=minimal'}});return true;}
  async function deleteMemberByCode(code){await rest(`trainlog_members?member_code=eq.${encodeURIComponent(code)}`,{method:'DELETE',headers:{Prefer:'return=minimal'}});return true;}
  window.TrainLogCloud={getConfig,setConfig,isConfigured,getSession,hasSession,signIn,signOut,listSchedules,createSchedule,updateSchedule,deleteSchedule,listExceptions,setScheduleException,deleteScheduleException,listMembers,createMember,updateMember,updateMemberByCode,deleteMember,deleteMemberByCode};
})();
