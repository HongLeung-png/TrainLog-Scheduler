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

  const mapSchedule=r=>({id:r.id,memberId:r.member_id||'',studentName:r.student_name||'',kind:r.course_kind==='temporary'?'temporary':'fixed',day:r.weekday==null?null:Number(r.weekday),date:r.course_date||'',startTime:String(r.start_time||'').slice(0,5),endTime:String(r.end_time||'').slice(0,5),type:r.course_type||'',trialAge:r.trial_age==null?'':Number(r.trial_age),trialMemberNeed:r.trial_member_need||'',trialParentNeed:r.trial_parent_need||'',trialNotes:r.trial_notes||'',notes:r.notes||'',createdAt:r.created_at||'',updatedAt:r.updated_at||'',source:'cloud'});
  const toSchedule=x=>({member_id:x.memberId||null,student_name:String(x.studentName||'').trim(),course_kind:x.kind==='temporary'?'temporary':'fixed',weekday:x.kind==='temporary'?null:Number(x.day),course_date:x.kind==='temporary'?x.date:null,start_time:x.startTime,end_time:x.endTime,course_type:x.type||'',trial_age:(x.trialAge===''||x.trialAge==null)?null:Number(x.trialAge),trial_member_need:x.trialMemberNeed||'',trial_parent_need:x.trialParentNeed||'',trial_notes:x.trialNotes||'',notes:x.notes||'',updated_at:new Date().toISOString()});
  async function listSchedules(){const rows=await rest('trainlog_schedules?select=id,member_id,student_name,course_kind,weekday,course_date,start_time,end_time,course_type,trial_age,trial_member_need,trial_parent_need,trial_notes,notes,created_at,updated_at&order=start_time.asc');return (rows||[]).map(mapSchedule);}
  async function createSchedule(x){const rows=await rest('trainlog_schedules?select=*',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify(toSchedule(x))});return mapSchedule(rows[0]);}
  async function updateSchedule(id,x){const rows=await rest(`trainlog_schedules?id=eq.${encodeURIComponent(id)}&select=*`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify(toSchedule(x))});return mapSchedule(rows[0]);}
  async function deleteSchedule(id){await rest(`trainlog_schedules?id=eq.${encodeURIComponent(id)}`,{method:'DELETE',headers:{Prefer:'return=minimal'}});return true;}

  const mapException=r=>({id:r.id,scheduleId:r.schedule_id,date:r.occurrence_date||'',status:r.status||'',movedToDate:r.moved_to_date||'',movedToStart:String(r.moved_to_start||'').slice(0,5),movedToEnd:String(r.moved_to_end||'').slice(0,5),createdAt:r.created_at||'',updatedAt:r.updated_at||''});
  /* moved 列是后加的。老库上 select 它会返回 400，
     所以先试完整列，失败后退回基础列并记住结果 —— 兼容路径，不是错误。 */
  let movedColumnsAvailable=null;
  const EXCEPTION_BASE='id,schedule_id,occurrence_date,status,created_at,updated_at';
  async function listExceptions(){
    if(movedColumnsAvailable===false){
      const rows=await rest(`trainlog_schedule_exceptions?select=${EXCEPTION_BASE}&order=occurrence_date.asc`);
      return (rows||[]).map(mapException);
    }
    try{
      const rows=await rest(`trainlog_schedule_exceptions?select=${EXCEPTION_BASE},moved_to_date,moved_to_start,moved_to_end&order=occurrence_date.asc`);
      movedColumnsAvailable=true;
      return (rows||[]).map(mapException);
    }catch(err){
      if(movedColumnsAvailable===true)throw err;
      /* 只有"列不存在"才回退。网络抖动也回退的话，会把这个会话永久标记成
         "没有 moved"，改期课从此静默消失 —— 看起来像数据丢了。 */
      const msg=String(err&&err.message||err);
      if(!/does not exist|42703/i.test(msg))throw err;
      movedColumnsAvailable=false;
      const rows=await rest(`trainlog_schedule_exceptions?select=${EXCEPTION_BASE}&order=occurrence_date.asc`);
      return (rows||[]).map(mapException);
    }
  }
  function movedSchemaReady(){return movedColumnsAvailable===true;}
  async function probeMovedSchema(){
    if(movedColumnsAvailable!==null)return movedColumnsAvailable;
    try{await listExceptions();}catch(_){return false;}
    return movedColumnsAvailable===true;
  }
  /* 改期与撤销都必须走原子 RPC：冲突检查与写入在同一个事务里，
     前端先查后写挡不住并发。 */
  async function moveOccurrence(scheduleId,fromDate,toDate,startTime,endTime,idempotencyKey){
    const data=await rest('rpc/trainlog_move_occurrence_atomic',{method:'POST',body:JSON.stringify({
      p_schedule_id:scheduleId,p_from_date:fromDate,p_to_date:toDate,
      p_to_start:startTime,p_to_end:endTime,p_idempotency_key:idempotencyKey
    })});
    return data||{ok:false,error:'empty_response'};
  }
  async function undoMoveOccurrence(scheduleId,fromDate){
    const data=await rest('rpc/trainlog_undo_move_atomic',{method:'POST',body:JSON.stringify({
      p_schedule_id:scheduleId,p_from_date:fromDate
    })});
    return data||{ok:false,error:'empty_response'};
  }
  async function setScheduleException(scheduleId,date,status){const rows=await rest('trainlog_schedule_exceptions?on_conflict=schedule_id,occurrence_date&select=*',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=representation'},body:JSON.stringify({schedule_id:scheduleId,occurrence_date:date,status,updated_at:new Date().toISOString()})});return mapException(rows[0]);}
  async function deleteScheduleException(scheduleId,date){await rest(`trainlog_schedule_exceptions?schedule_id=eq.${encodeURIComponent(scheduleId)}&occurrence_date=eq.${encodeURIComponent(date)}`,{method:'DELETE',headers:{Prefer:'return=minimal'}});return true;}

  const mapMember=r=>({id:r.id,memberCode:r.member_code||'',name:r.name||'',alias:r.alias||'',sex:r.sex||'',birth:r.birth||'',goal:r.goal||'',contact:r.contact||'',notes:r.notes||'',profile:r.profile||{},createdAt:r.created_at||'',updatedAt:r.updated_at||''});
  const toMember=x=>{const row={name:String(x.name||'').trim(),alias:String(x.alias||'').trim(),sex:x.sex||'',birth:x.birth||null,goal:x.goal||'',contact:x.contact||'',notes:x.notes||'',profile:x.profile||{},updated_at:new Date().toISOString()};if(x.memberCode)row.member_code=String(x.memberCode).trim();return row;};
  async function listMembers(){const rows=await rest('trainlog_members?select=id,member_code,name,alias,sex,birth,goal,contact,notes,profile,created_at,updated_at&order=member_code.asc');return (rows||[]).map(mapMember);}
  async function createMember(x){const rows=await rest('trainlog_members?select=*',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify(toMember(x))});return mapMember(rows[0]);}
  async function updateMember(id,x){const rows=await rest(`trainlog_members?id=eq.${encodeURIComponent(id)}&select=*`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify(toMember(x))});return mapMember(rows[0]);}
  async function updateMemberByCode(code,x){const rows=await rest(`trainlog_members?member_code=eq.${encodeURIComponent(code)}&select=*`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify(toMember({...x,memberCode:code}))});return rows?.[0]?mapMember(rows[0]):null;}
  async function deleteMember(id){await rest(`trainlog_members?id=eq.${encodeURIComponent(id)}`,{method:'DELETE',headers:{Prefer:'return=minimal'}});return true;}
  async function deleteMemberByCode(code){await rest(`trainlog_members?member_code=eq.${encodeURIComponent(code)}`,{method:'DELETE',headers:{Prefer:'return=minimal'}});return true;}

  const mapLock=r=>({id:r.id,date:r.lock_date||'',startTime:String(r.start_time||'').slice(0,5),endTime:String(r.end_time||'').slice(0,5),repeatWeekly:!!r.repeat_weekly,notes:r.notes||'',createdAt:r.created_at||'',updatedAt:r.updated_at||''});
  async function listLocks(){const rows=await rest('trainlog_schedule_locks?select=id,lock_date,start_time,end_time,repeat_weekly,notes,created_at,updated_at&order=lock_date.asc,start_time.asc');return (rows||[]).map(mapLock);}
  async function createLock(x){const rows=await rest('trainlog_schedule_locks?select=*',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({lock_date:x.date,start_time:x.startTime,end_time:x.endTime,repeat_weekly:!!x.repeatWeekly,notes:x.notes||'',updated_at:new Date().toISOString()})});return mapLock(rows[0]);}
  async function deleteLock(id){await rest(`trainlog_schedule_locks?id=eq.${encodeURIComponent(id)}`,{method:'DELETE',headers:{Prefer:'return=minimal'}});return true;}

  const mapContent=r=>({id:r.id,scheduleId:r.schedule_id,date:r.occurrence_date||'',tests:Array.isArray(r.tests)?r.tests:[],training:Array.isArray(r.training)?r.training:[],trainingNotes:r.training_notes||'',parentGoal:r.parent_goal||'',parentSummary:r.parent_summary||'',parentFeedback:r.parent_feedback||'',createdAt:r.created_at||'',updatedAt:r.updated_at||''});
  async function listScheduleContents(){const rows=await rest('trainlog_schedule_contents?select=id,schedule_id,occurrence_date,tests,training,training_notes,parent_goal,parent_summary,parent_feedback,created_at,updated_at&order=occurrence_date.asc');return (rows||[]).map(mapContent);}
  async function upsertScheduleContent(x){const rows=await rest('trainlog_schedule_contents?on_conflict=schedule_id,occurrence_date&select=*',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=representation'},body:JSON.stringify({schedule_id:x.scheduleId,occurrence_date:x.date,tests:x.tests||[],training:x.training||[],training_notes:x.trainingNotes||'',parent_goal:x.parentGoal||'',parent_summary:x.parentSummary||'',parent_feedback:x.parentFeedback||'',updated_at:new Date().toISOString()})});return mapContent(rows[0]);}

  window.TrainLogCloud={getConfig,setConfig,isConfigured,getSession,hasSession,signIn,signOut,listSchedules,createSchedule,updateSchedule,deleteSchedule,listExceptions,setScheduleException,deleteScheduleException,moveOccurrence,undoMoveOccurrence,movedSchemaReady,probeMovedSchema,listMembers,createMember,updateMember,updateMemberByCode,deleteMember,deleteMemberByCode,listLocks,createLock,deleteLock,listScheduleContents,upsertScheduleContent};
})();
