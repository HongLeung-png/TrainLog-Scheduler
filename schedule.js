const WEEK=[
  {v:1,s:'周一'},{v:2,s:'周二'},{v:3,s:'周三'},{v:4,s:'周四'},
  {v:5,s:'周五'},{v:6,s:'周六'},{v:7,s:'周日'}
];
const $=id=>document.getElementById(id);
const MEMBER_PAGE_SIZE=10;
let schedules=[],members=[],exceptions=[],locks=[],contents=[],selected=today();
let memberPage=1,memberSearchQuery='',courseSaving=false,memberSaving=false;

function today(){return dateStr(new Date())}
function ageFromBirth(birth){
  if(!birth)return '';
  const b=parse(birth),n=new Date();
  let a=n.getFullYear()-b.getFullYear();
  const m=n.getMonth()-b.getMonth();
  if(m<0||(m===0&&n.getDate()<b.getDate()))a--;
  return a;
}
function birthFromAge(age){
  const a=Number(age);
  return Number.isFinite(a)&&a>=0&&a<=120?`${new Date().getFullYear()-Math.floor(a)}-01-01`:'';
}
function dateStr(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
function parse(s){const[a,b,c]=String(s).split('-').map(Number);return new Date(a,b-1,c,12)}
function wd(s){const n=parse(s).getDay();return n||7}
function shift(s,n){const d=parse(s);d.setDate(d.getDate()+n);return dateStr(d)}
function week(s){
  const d=parse(s);d.setDate(d.getDate()-(wd(s)-1));
  return WEEK.map((w,i)=>{const x=new Date(d);x.setDate(d.getDate()+i);return{...w,date:dateStr(x),md:`${x.getMonth()+1}/${x.getDate()}`}})
}
function kind(x){return x.kind==='temporary'?'temporary':'fixed'}
function exceptionFor(id,date){return exceptions.find(e=>String(e.scheduleId)===String(id)&&e.date===date)||null}
function rows(date){
  return schedules
    .filter(x=>kind(x)==='fixed'?Number(x.day)===wd(date):x.date===date)
    .map(x=>{const ex=exceptionFor(x.id,date);return {...x,occurrenceDate:date,attendanceStatus:ex?.status||''}})
    .filter(x=>x.attendanceStatus!=='cancelled')
    .sort((a,b)=>a.startTime.localeCompare(b.startTime));
}
function esc(v){const d=document.createElement('div');d.textContent=v??'';return d.innerHTML}
function tm(t){const[h,m]=String(t).split(':').map(Number);return(h||0)*60+(m||0)}
function mt(n){return `${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`}
function slots(){const a=[];for(let m=540;m<1260;m+=30)a.push(mt(m));return a}
function slotRows(date,slot){const a=tm(slot),b=a+30;return rows(date).filter(x=>tm(x.startTime)<b&&tm(x.endTime)>a)}
function isTrial(x){return x?.type==='首次体验'}
function intervalsOverlap(a,b){return tm(a.startTime)<tm(b.endTime)&&tm(a.endTime)>tm(b.startTime)}

function contentFor(scheduleId,date){return contents.find(x=>String(x.scheduleId)===String(scheduleId)&&x.date===date)||null}
function lockAppliesToDate(lock,date){return lock?.repeatWeekly?(!!lock.date&&lock.date<=date&&wd(lock.date)===wd(date)):lock?.date===date}
function locksForDate(date){return locks.filter(x=>lockAppliesToDate(x,date)).sort((a,b)=>a.startTime.localeCompare(b.startTime))}
function findLockConflict(candidate,sourceLocks=locks){return (sourceLocks||[]).find(lock=>{if(!intervalsOverlap(candidate,lock))return false;if(kind(candidate)==='temporary')return lockAppliesToDate(lock,candidate.date);if(lock.repeatWeekly)return wd(lock.date)===Number(candidate.day);return lock.date>=today()&&wd(lock.date)===Number(candidate.day)})||null}
function lockConflictMessage(lock){return `该时间段已锁定：${lock.repeatWeekly?'每周 '+WEEK.find(x=>x.v===wd(lock.date))?.s:lock.date} ${lock.startTime}–${lock.endTime}${lock.notes?` · ${lock.notes}`:''}`}
function readonlyContentHtml(detail){if(!detail||(!(detail.tests||[]).length&&!(detail.training||[]).length))return '<div class="empty small">该课程还没有安排测试或训练。</div>';return `<div class="readonly-content">${detail.tests?.length?`<h3>测试内容</h3><table class="content-table"><tbody>${detail.tests.map(x=>`<tr><td>${esc(x.category||'')}</td><td>${esc(x.subgroup||'')}</td><td>${esc(x.testName||'')}</td></tr>`).join('')}</tbody></table>`:''}${detail.training?.length?`<h3>训练内容</h3><table class="content-table"><tbody>${detail.training.map(x=>`<tr><td>${esc(x.category||'')}</td><td>${esc(x.name||'')}</td><td>${esc(x.sets||'')}组 × ${esc(x.reps||'')}</td><td>${esc(x.load||'')}</td></tr>`).join('')}</tbody></table>${detail.trainingNotes?`<p class="content-notes">${esc(detail.trainingNotes)}</p>`:''}`:''}</div>`}
function openContent(x,date){const detail=contentFor(x.id,date);$('contentTitle').textContent=`${scheduleDisplayName(x)} · ${date}`;$('contentBody').innerHTML=readonlyContentHtml(detail);$('contentDialog').showModal()}

function memberDisplayName(m){
  const name=String(m?.name||'').trim();
  const alias=String(m?.alias||'').trim();
  return name&&alias?`${name}-${alias}`:(name||alias||'未命名会员');
}
function memberSearchText(m){
  return `${m?.memberCode||''} ${m?.name||''} ${m?.alias||''} ${m?.goal||''} ${m?.contact||''}`.toLowerCase();
}
function scheduleDisplayName(x){
  const raw=String(x?.studentName||'').trim();
  const found=members.find(m=>x?.memberId===m.id||(()=>{const base=String(m.name||'').trim();const alias=String(m.alias||'').trim();return raw===base||raw===alias||raw===memberDisplayName(m)})());
  return found?memberDisplayName(found):raw;
}

function findConflict(candidate,ignoreId='',sourceSchedules=schedules,sourceExceptions=exceptions){
  const ck=kind(candidate);
  const exFor=(id,date)=>(sourceExceptions||[]).find(e=>String(e.scheduleId)===String(id)&&e.date===date)||null;
  for(const other of sourceSchedules||[]){
    if(ignoreId&&String(other.id)===String(ignoreId))continue;
    if(!intervalsOverlap(candidate,other))continue;
    const ok=kind(other);
    if(ck==='fixed'&&ok==='fixed'){
      if(Number(candidate.day)===Number(other.day))return other;
      continue;
    }
    if(ck==='temporary'&&ok==='temporary'){
      if(candidate.date&&candidate.date===other.date)return other;
      continue;
    }
    if(ck==='temporary'&&ok==='fixed'){
      if(!candidate.date||wd(candidate.date)!==Number(other.day))continue;
      if(exFor(other.id,candidate.date)?.status==='cancelled')continue;
      return other;
    }
    if(ck==='fixed'&&ok==='temporary'){
      if(!other.date||wd(other.date)!==Number(candidate.day))continue;
      if(other.date<today())continue;
      return other;
    }
  }
  return null;
}
function conflictMessage(x){
  return `该时间段已被「${scheduleDisplayName(x)}」${x.startTime}–${x.endTime} 占用，请选择其它时间。`;
}

function weeklyClassCount(days){
  return days.reduce((sum,d)=>sum+rows(d.date).filter(x=>x.attendanceStatus!=='leave').length,0);
}

function render(){
  const days=week(selected);
  const weekClasses=weeklyClassCount(days);
  $('status').textContent=`总会员 ${members.length} 位 · 本周课时 ${weekClasses} 节`;
  $('app').innerHTML=`
    <div class="weeknav">
      <button class="secondary" id="prev">‹ 上一周</button>
      <div class="notice summary">${days[0].date} — ${days[6].date}</div>
      <button class="secondary" id="now">本周</button>
      <button class="secondary" id="next">下一周 ›</button>
    </div>
    <div class="weekdays">
      ${days.map(d=>`<button class="day ${d.date===selected?'active':''}" data-date="${d.date}">
        <span>${d.s}</span><small>${d.md} · ${rows(d.date).length}节</small>
      </button>`).join('')}
    </div>
    ${timeline(selected)}
    <div class="members">
      <div class="members-head">
        <h2>会员</h2>
        <input id="memberListSearch" placeholder="搜索姓名 / 英文名 / 小名">
      </div>
      <div id="memberList"></div>
      <div id="memberPagination" class="member-pagination"></div>
    </div>`;

  $('prev').onclick=()=>{selected=shift(selected,-7);render()};
  $('next').onclick=()=>{selected=shift(selected,7);render()};
  $('now').onclick=()=>{selected=today();render()};
  document.querySelectorAll('.day').forEach(b=>b.onclick=()=>{selected=b.dataset.date;render()});
  bindCourseCards();
  document.querySelectorAll('.slot-add').forEach(b=>b.onclick=()=>openCourse(null,b.dataset.time));

  const search=$('memberListSearch');
  search.value=memberSearchQuery;
  search.oninput=e=>{
    memberSearchQuery=e.target.value.trim();
    memberPage=1;
    renderMemberPanel();
  };
  renderMemberPanel();
}

function eventClass(x){
  if(x?.attendanceStatus==='leave')return 'event-leave';
  return isTrial(x)?'event-trial':(kind(x)==='temporary'?'event-temp':'event-fixed');
}
function eventPlacement(x){
  const start=Math.max(540,tm(x.startTime)),end=Math.min(1260,tm(x.endTime));
  const rowStart=Math.floor((start-540)/30)+1,rowEnd=Math.ceil((end-540)/30)+1;
  return{rowStart,span:Math.max(1,rowEnd-rowStart)};
}
function timeline(date){
  const dayRows=rows(date),dayLocks=locksForDate(date),ss=slots();
  let html='<div class="timeline timeline-grid">';
  ss.forEach((s,i)=>{
    const a=tm(s),b=a+30,eventOccupied=slotRows(date,s).length>0,lockOccupied=dayLocks.some(x=>tm(x.startTime)<b&&tm(x.endTime)>a),occupied=eventOccupied||lockOccupied;
    html+=`<div class="slot-time grid-time" style="grid-row:${i+1};grid-column:1">${s}</div><div class="slot-bg ${occupied?'occupied':''} ${lockOccupied?'locked-bg':''}" style="grid-row:${i+1};grid-column:2"></div>`;
    if(!occupied)html+=`<button class="slot-add" data-time="${s}" style="grid-row:${i+1};grid-column:2">＋ 点击约课</button>`;
  });
  dayLocks.forEach(x=>{const p=eventPlacement(x);html+=`<div class="web-lock-card" style="grid-row:${p.rowStart} / span ${p.span};grid-column:2"><strong>🔒 已锁定 ${esc(x.startTime)}–${esc(x.endTime)}</strong><small>${x.repeatWeekly?'每周固定 · ':''}${esc(x.notes||'该时段不可约')}</small></div>`});
  dayRows.forEach(x=>{const p=eventPlacement(x);html+=card(x,p.rowStart,p.span)});
  html+='</div><div class="timeline-end"><span>21:00</span></div>';return html;
}

function card(x,rowStart=1,span=1){
  const leave=x.attendanceStatus==='leave',detail=contentFor(x.id,x.occurrenceDate),hasContent=!!(detail?.tests?.length||detail?.training?.length);
  const label=leave?'已请假':(isTrial(x)?'首次体验':(kind(x)==='temporary'?'临时约课':'固定课'));
  return `<div class="course merged-course ${eventClass(x)}" style="grid-row:${rowStart} / span ${span};grid-column:2" data-id="${x.id}">
    <div class="course-main"><strong>${x.startTime}–${x.endTime} · ${esc(scheduleDisplayName(x))}</strong><small>${esc(x.type||'综合')}${x.trialAge?` · ${esc(x.trialAge)}岁`:''}${x.notes?` · ${esc(x.notes)}`:''}${hasContent?' · 已安排内容':''}</small></div>
    <div class="course-side"><span class="tag">${label}</span><div class="course-actions">
      <button type="button" class="course-content tiny" data-id="${x.id}" data-date="${x.occurrenceDate}">内容</button>
      <button type="button" class="course-edit tiny" data-id="${x.id}">编辑</button>
      <button type="button" class="course-leave tiny" data-id="${x.id}" data-date="${x.occurrenceDate}">${leave?'恢复':'请假'}</button>
      <button type="button" class="course-cancel tiny cancel" data-id="${x.id}" data-date="${x.occurrenceDate}">取消</button>
    </div></div>
  </div>`;
}

function bindCourseCards(){
  document.querySelectorAll('.course').forEach(b=>b.onclick=e=>{if(e.target.closest('.course-actions'))return;const x=schedules.find(x=>x.id===b.dataset.id);if(x)openContent({...x,occurrenceDate:selected},selected)});
  document.querySelectorAll('.course-content').forEach(b=>b.onclick=e=>{e.stopPropagation();const x=schedules.find(s=>String(s.id)===String(b.dataset.id));if(x)openContent(x,b.dataset.date)});
  document.querySelectorAll('.course-edit').forEach(b=>b.onclick=e=>{e.stopPropagation();const x=schedules.find(s=>String(s.id)===String(b.dataset.id));if(x)openCourse(x)});
  document.querySelectorAll('.course-leave').forEach(b=>b.onclick=async e=>{e.stopPropagation();const id=b.dataset.id,date=b.dataset.date,ex=exceptionFor(id,date);try{if(ex?.status==='leave')await TrainLogCloud.deleteScheduleException(id,date);else await TrainLogCloud.setScheduleException(id,date,'leave');await load()}catch(err){alert('请假操作失败：'+err.message)}});
  document.querySelectorAll('.course-cancel').forEach(b=>b.onclick=async e=>{e.stopPropagation();const id=b.dataset.id,date=b.dataset.date,x=schedules.find(s=>String(s.id)===String(id));if(!x)return;try{if(kind(x)==='fixed')await TrainLogCloud.setScheduleException(id,date,'cancelled');else await TrainLogCloud.deleteSchedule(id);await load()}catch(err){alert('取消课程失败：'+err.message)}});
}

function filteredMembers(){
  const q=memberSearchQuery.toLowerCase();
  return members.filter(m=>!q||memberSearchText(m).includes(q));
}
function memberList(arr){
  return arr.length?arr.map(m=>`<button class="member-edit" data-id="${m.id}">
    <strong>${esc(memberDisplayName(m))}</strong>
    <small>编号 ${esc(m.memberCode||'—')} · ${esc(m.goal||'未填写目标')}${m.contact?` · ${esc(m.contact)}`:''}</small>
  </button>`).join(''):'<div class="empty small">没有匹配会员。</div>';
}
function renderMemberPanel(){
  const arr=filteredMembers();
  const totalPages=Math.max(1,Math.ceil(arr.length/MEMBER_PAGE_SIZE));
  if(memberPage>totalPages)memberPage=totalPages;
  if(memberPage<1)memberPage=1;
  const start=(memberPage-1)*MEMBER_PAGE_SIZE;
  const pageItems=arr.slice(start,start+MEMBER_PAGE_SIZE);
  $('memberList').innerHTML=memberList(pageItems);
  $('memberPagination').innerHTML=`
    <button type="button" class="secondary member-page-btn" id="memberPrev" ${memberPage<=1?'disabled':''}>上一页</button>
    <span>第 ${memberPage} / ${totalPages} 页 · 共 ${arr.length} 位</span>
    <button type="button" class="secondary member-page-btn" id="memberNext" ${memberPage>=totalPages?'disabled':''}>下一页</button>`;
  document.querySelectorAll('.member-edit').forEach(b=>b.onclick=()=>openMember(members.find(x=>x.id===b.dataset.id)));
  $('memberPrev').onclick=()=>{if(memberPage>1){memberPage--;renderMemberPanel()}};
  $('memberNext').onclick=()=>{if(memberPage<totalPages){memberPage++;renderMemberPanel()}};
}

function fillMembers(q='',selectedRef=''){
  const needle=String(q||'').trim().toLowerCase();
  const a=members.filter(m=>!needle||memberSearchText(m).includes(needle));
  const current=String(selectedRef||'').trim();
  const options=a.map(m=>{
    const value=String(m.name||m.alias||'').trim();
    const selected=m.id===current||value===current||memberDisplayName(m)===current;
    return `<option value="${esc(value)}" data-member-id="${esc(m.id)}" ${selected?'selected':''}>${esc(m.memberCode||'——')} · ${esc(memberDisplayName(m))}</option>`;
  }).join('');
  const hasCurrent=a.some(m=>m.id===current||String(m.name||m.alias||'').trim()===current||memberDisplayName(m)===current);
  $('studentName').innerHTML=(current&&!hasCurrent?`<option value="${esc(current)}" selected>${esc(current)}</option>`:'')+options||'<option value="">暂无会员</option>';
}

function toggleFields(){
  const trial=$('appointmentType').value==='trial';
  if(trial)$('kind').value='temporary';
  $('scheduleKindField').style.display=trial?'none':'';
  $('regularStudentFields').style.display=trial?'none':'';
  $('trialStudentField').style.display=trial?'':'none';
  $('regularCourseTypeField').style.display=trial?'none':'';
  const temp=trial||$('kind').value==='temporary';
  $('fixedField').style.display=temp?'none':'';
  $('tempField').style.display=temp?'':'none';
}
function openCourse(x=null,preset=''){
  $('courseTitle').textContent=x?'编辑课程':'安排课程';
  $('courseId').value=x?.id||'';
  const trial=isTrial(x);
  $('appointmentType').value=trial?'trial':'regular';
  $('kind').value=trial?'temporary':kind(x||{});
  $('studentSearch').value='';
  fillMembers('',trial?(members[0]?.id||''):(x?.memberId||x?.studentName||members[0]?.id||''));
  $('trialName').value=trial?x.studentName:'';
  $('trialAge').value=trial?(x.trialAge||''):'';
  $('weekday').value=x?.day||wd(selected);
  $('courseDate').value=x?.date||selected;
  $('startTime').value=x?.startTime||preset||'16:00';
  $('endTime').value=x?.endTime||(preset?mt(Math.min(tm(preset)+60,1260)):'17:00');
  $('courseType').value=trial?'综合':(x?.type||'综合');
  $('notes').value=x?.notes||'';
  $('deleteBtn').classList.toggle('hidden',!x);
  toggleFields();
  $('courseDialog').showModal();
}
function openMember(x=null){
  $('memberTitle').textContent=x?'编辑会员':'创建会员';
  $('memberId').value=x?.id||'';
  $('memberCode').value=x?.memberCode||'保存后自动生成6位编号';
  $('memberName').value=x?.name||'';
  $('memberAlias').value=x?.alias||'';
  $('memberSex').value=x?.sex||'';
  $('memberBirth').value=x?.birth||'';
  $('memberAge').value=ageFromBirth(x?.birth)||'';
  $('memberGoal').value=x?.goal||'';
  $('memberContact').value=x?.contact||'';
  $('memberNotes').value=x?.notes||'';
  $('deleteMemberBtn').classList.toggle('hidden',!x);
  $('memberDialog').showModal();
}
async function load(){
  try{
    [schedules,members,exceptions,locks,contents]=await Promise.all([
      TrainLogCloud.listSchedules(),
      TrainLogCloud.listMembers(),
      TrainLogCloud.listExceptions?TrainLogCloud.listExceptions():Promise.resolve([]),
      TrainLogCloud.listLocks?TrainLogCloud.listLocks():Promise.resolve([]),
      TrainLogCloud.listScheduleContents?TrainLogCloud.listScheduleContents():Promise.resolve([])
    ]);
    render();
  }catch(e){
    $('status').textContent='同步失败：'+e.message;
    $('app').innerHTML='<div class="empty">无法连接共享课表</div>';
  }
}

$('appointmentType').onchange=toggleFields;
$('kind').onchange=toggleFields;
$('studentSearch').oninput=e=>fillMembers(e.target.value,$('studentName').value);
$('addBtn').onclick=()=>openCourse();
$('memberBtn').onclick=()=>openMember();
$('cancelCourse').onclick=()=>$('courseDialog').close();
$('cancelMember').onclick=()=>$('memberDialog').close();
$('closeContent').onclick=()=>$('contentDialog').close();
$('weekday').innerHTML=WEEK.map(x=>`<option value="${x.v}">${x.s}</option>`).join('');
$('memberAge').oninput=()=>{const b=birthFromAge($('memberAge').value);if(b)$('memberBirth').value=b};
$('memberBirth').onchange=()=>{$('memberAge').value=ageFromBirth($('memberBirth').value)||''};

$('courseForm').onsubmit=async e=>{
  e.preventDefault();
  if(courseSaving)return;
  const trial=$('appointmentType').value==='trial';
  const selectedOption=$('studentName')?.selectedOptions?.[0];
  const memberId=trial?'':String(selectedOption?.dataset?.memberId||'');
  const selectedMember=memberId?members.find(m=>m.id===memberId):null;
  const studentName=trial?$('trialName').value.trim():(selectedMember?memberDisplayName(selectedMember):$('studentName').value);
  const k=trial?'temporary':$('kind').value;
  const x={
    memberId,studentName,kind:k,
    day:k==='fixed'?Number($('weekday').value):null,
    date:k==='temporary'?$('courseDate').value:'',
    startTime:$('startTime').value,endTime:$('endTime').value,
    type:trial?'首次体验':$('courseType').value,
    trialAge:trial?$('trialAge').value:'',
    notes:$('notes').value.trim()
  };
  if(!x.studentName)return alert(trial?'请输入体验学员姓名':'请选择会员');
  if(x.endTime<=x.startTime)return alert('结束时间需要晚于开始时间');
  if(x.kind==='temporary'&&!x.date)return alert('临时约课 / 首次体验需要日期');
  const id=$('courseId').value;
  const localConflict=findConflict(x,id);
  if(localConflict)return alert(conflictMessage(localConflict));
  const localLock=findLockConflict(x);
  if(localLock)return alert(lockConflictMessage(localLock));

  courseSaving=true;
  const saveBtn=$('saveCourseBtn')||$('courseForm').querySelector('button[type="submit"]');
  if(saveBtn){saveBtn.disabled=true;saveBtn.textContent='保存中…'}
  try{
    const [freshSchedules,freshExceptions,freshLocks]=await Promise.all([
      TrainLogCloud.listSchedules(),
      TrainLogCloud.listExceptions?TrainLogCloud.listExceptions():Promise.resolve([]),
      TrainLogCloud.listLocks?TrainLogCloud.listLocks():Promise.resolve([])
    ]);
    schedules=freshSchedules;exceptions=freshExceptions;locks=freshLocks;
    const freshConflict=findConflict(x,id,freshSchedules,freshExceptions);
    if(freshConflict)throw new Error(conflictMessage(freshConflict));
    const freshLock=findLockConflict(x,freshLocks);
    if(freshLock)throw new Error(lockConflictMessage(freshLock));
    if(id)await TrainLogCloud.updateSchedule(id,x);
    else await TrainLogCloud.createSchedule(x);
    $('courseDialog').close();
    await load();
  }catch(err){
    alert('保存失败：'+err.message);
  }finally{
    courseSaving=false;
    if(saveBtn){saveBtn.disabled=false;saveBtn.textContent='保存'}
  }
};

$('deleteBtn').onclick=async()=>{
  const id=$('courseId').value;
  if(!id||!confirm('确定删除这节课程？'))return;
  try{
    await TrainLogCloud.deleteSchedule(id);
    $('courseDialog').close();
    await load();
  }catch(err){alert('删除失败：'+err.message)}
};

$('memberForm').onsubmit=async e=>{
  e.preventDefault();
  if(memberSaving)return;
  const saveBtn=$('memberForm').querySelector('button[type="submit"]');
  const currentId=$('memberId').value;
  const existingMember=currentId?members.find(m=>String(m.id)===String(currentId)):null;
  const x={
    syncKey:existingMember?.syncKey||`web:${window.crypto?.randomUUID?.()||Date.now()+'_'+Math.random().toString(36).slice(2)}`,
    name:$('memberName').value.trim(),
    alias:$('memberAlias').value.trim(),
    sex:$('memberSex').value,
    birth:$('memberBirth').value,
    goal:$('memberGoal').value.trim(),
    contact:$('memberContact').value.trim(),
    notes:$('memberNotes').value.trim(),
    memberCode:existingMember?.memberCode||''
  };
  if(!x.name&&!x.alias)return alert('姓名或英文名/小名至少填写一项');
  memberSaving=true;
  if(saveBtn){saveBtn.disabled=true;saveBtn.textContent='保存中…'}
  try{
    const id=currentId;
    if(id)await TrainLogCloud.updateMember(id,x);
    else await TrainLogCloud.createMember(x);
    $('memberDialog').close();
    await load();
  }catch(err){alert('会员保存失败：'+err.message)}
  finally{memberSaving=false;if(saveBtn){saveBtn.disabled=false;saveBtn.textContent='保存会员'}}
};

$('deleteMemberBtn').onclick=async()=>{
  const id=$('memberId').value;
  if(!id||!confirm('确定删除该会员？该会员对应的课表也会一起删除。'))return;
  try{
    await TrainLogCloud.deleteMember(id);
    $('memberDialog').close();
    await load();
  }catch(err){alert('删除失败：'+err.message)}
};

load();
