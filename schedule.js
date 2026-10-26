const WEEK=[
  {v:1,s:'周一'},{v:2,s:'周二'},{v:3,s:'周三'},{v:4,s:'周四'},
  {v:5,s:'周五'},{v:6,s:'周六'},{v:7,s:'周日'}
];
const $=id=>document.getElementById(id);
const MEMBER_PAGE_SIZE=10;
let schedules=[],members=[],exceptions=[],locks=[],contents=[],selected=today();
let memberPage=1,memberSearchQuery='',courseSaving=false,memberSaving=false;

/* 时间轴刻度：09:00–21:00，每 30 分钟一格。这里只描述画布，不参与任何业务计算。 */
const DAY_START=540, DAY_END=1260, DAY_SPAN=DAY_END-DAY_START;

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
function trainingDoseText(x={}){const value=String(x.reps||'').trim(),unit=String(x.unit||'').trim();if(!value)return '';if(!unit||value.endsWith(unit)||/[秒分米次个趟步圈]$/.test(value)||/\b(km|m)$/i.test(value))return value;return `${value}${unit}`;}

/* ── 只读课程内容：层次化面板，训练/测试各自成表 ── */
function readonlyContentHtml(detail){
  if(!detail||(!(detail.tests||[]).length&&!(detail.training||[]).length&&!detail.parentGoal&&!detail.parentSummary&&!detail.parentFeedback))
    return '<div class="empty small">该课程还没有安排测试或训练。</div>';
  const overview=[detail.parentGoal,detail.parentSummary].filter(Boolean);
  const training=(detail.training||[]).map(x=>`
    <tr>
      <td>${esc(x.category||'')}</td>
      <td>${esc(x.name||'')}</td>
      <td>${esc(x.sets||'')}组 × ${esc(trainingDoseText(x))}</td>
      <td>${esc(x.load||'')}</td>
    </tr>`).join('');
  const tests=(detail.tests||[]).map(x=>`
    <tr>
      <td>${esc(x.category||'')}</td>
      <td>${esc(x.subgroup||'')}</td>
      <td>${esc(x.testName||'')}</td>
    </tr>`).join('');
  return `<div class="readonly-content">
    ${overview.length?`<section class="course-overview"><h3>课程概览</h3>${overview.map(x=>`<p>${esc(x)}</p>`).join('')}</section>`:''}
    ${tests?`<section><h3>测试内容</h3><table class="content-table"><tbody>${tests}</tbody></table></section>`:''}
    ${training?`<section><h3>训练内容</h3><table class="content-table"><tbody>${training}</tbody></table></section>`:''}
    ${detail.parentFeedback?`<section class="course-feedback"><h3>课后小结</h3><p>${esc(detail.parentFeedback)}</p></section>`:''}
  </div>`;
}
function openContent(x,date){
  const detail=contentFor(x.id,date);
  $('contentTitle').textContent=`${scheduleDisplayName(x)} · ${date}`;
  $('contentBody').innerHTML=readonlyContentHtml(detail);
  $('contentDialog').showModal();
}

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

/* ══════════════ UI 基础设施：提示 / 确认 / 按钮状态 ══════════════ */

function notify(message,type='',timeout=3200){
  const text=String(message??'').trim();
  if(!text)return;
  if(!type){
    if(/失败|错误|异常|无法|不可|不能/.test(text))type='error';
    else if(/请|需要|至少|先/.test(text))type='warn';
    else type='ok';
  }
  const host=$('toastHost');
  const el=document.createElement('div');
  el.className='toast '+type;
  el.textContent=text;
  host.appendChild(el);
  let done=false;
  const dismiss=()=>{if(done)return;done=true;el.classList.add('leaving');setTimeout(()=>el.remove(),200)};
  const timer=setTimeout(dismiss,timeout);
  el.addEventListener('click',()=>{clearTimeout(timer);dismiss()});
}

/* 自定义确认框：替代原生 confirm，样式与主题一致，保留二次确认语义 */
let confirmResolve=null;
function askConfirm(title,text,okLabel='确认'){
  return new Promise(resolve=>{
    $('confirmTitle').textContent=title;
    $('confirmText').textContent=text;
    $('confirmOk').textContent=okLabel;
    confirmResolve=resolve;
    $('confirmDialog').showModal();
  });
}
$('confirmOk').onclick=()=>{const r=confirmResolve;confirmResolve=null;$('confirmDialog').close();r?.(true)};
$('confirmCancel').onclick=()=>{const r=confirmResolve;confirmResolve=null;$('confirmDialog').close();r?.(false)};
$('confirmDialog').addEventListener('close',()=>{if(confirmResolve){const r=confirmResolve;confirmResolve=null;r(false)}});

/* 保存按钮四态：idle / saving / ok / error。
   颜色直接写内联样式，避免被 .btn.primary 的主色覆盖。 */
const BTN_STATES={
  saving:{ bg:'#1A1F23', border:'#3A4145', color:'#929CA4' },
  ok:    { bg:'#0C2620', border:'#32C99A', color:'#32C99A' },
  error: { bg:'#261114', border:'#ED6673', color:'#ED6673' }
};
function setBtnState(btn,state,label){
  if(!btn)return;
  btn.dataset.state=state;
  btn.disabled=state==='saving'||state==='ok';
  if(label)btn.textContent=label;
  else if(state==='idle')btn.textContent=btn.dataset.idleLabel||'保存';
  const s=BTN_STATES[state];
  if(s){
    btn.style.background=s.bg;
    btn.style.borderColor=s.border;
    btn.style.color=s.color;
  }else{
    btn.style.background='';
    btn.style.borderColor='';
    btn.style.color='';
  }
}

function setStatus(text,isError=false){
  const el=$('status');
  el.textContent=text||'';
  el.classList.toggle('error',!!isError);
}

/* ══════════════ 渲染 ══════════════ */

function render(){
  const days=week(selected);
  const weekClasses=weeklyClassCount(days);

  $('barWeekRange').textContent=`${days[0].md} – ${days[6].md}`;
  $('barWeekCount').textContent=String(weekClasses);
  $('barMemberCount').textContent=String(members.length);

  $('app').innerHTML=`
    <div class="weeknav">
      <button type="button" class="btn ghost" id="prev">‹ 上一周</button>
      <span class="summary">${days[0].date} — ${days[6].date}</span>
      <button type="button" class="btn ghost" id="now">本周</button>
      <button type="button" class="btn ghost" id="next">下一周 ›</button>
    </div>
    <div class="weekdays">
      ${days.map(d=>{
        const n=rows(d.date).length;
        const isToday=d.date===today();
        return `<button type="button" class="day ${d.date===selected?'active':''} ${isToday?'is-today':''}" data-date="${d.date}" aria-pressed="${d.date===selected}">
          <span class="day-name">${d.s}</span>
          <b class="day-num">${Number(d.md.split('/')[1])}</b>
          <span class="day-count ${n?'':'is-zero'}">${n?n+' 节':'—'}</span>
        </button>`;
      }).join('')}
    </div>
    <div class="schedule-legend" aria-label="课表类型说明">
      <span>固定课</span><span class="legend-temp">临时约课</span><span class="legend-trial">首次体验</span><span class="legend-leave">请假 / 锁定</span>
    </div>
    ${timeline(selected)}`;

  $('prev').onclick=()=>{selected=shift(selected,-7);render()};
  $('next').onclick=()=>{selected=shift(selected,7);render()};
  $('now').onclick=()=>{selected=today();render()};
  document.querySelectorAll('.day').forEach(b=>b.onclick=()=>{selected=b.dataset.date;render()});

  bindCourseCards();
  $('app').querySelectorAll('.slot-add').forEach(b=>b.onclick=()=>openCourse(null,b.dataset.time));

  renderMemberPanel();
}

function eventClass(x){
  if(x?.attendanceStatus==='leave')return 'event-leave';
  return isTrial(x)?'event-trial':(kind(x)==='temporary'?'event-temp':'event-fixed');
}

/* 关键：按真实分钟数定位，不再吸附到半小时网格。
   09:00 为 0%，21:00 为 100%，10:07–10:53 会得到 9.3% 的起点和 6.4% 的高度。 */
function place(x){
  const rawStart=tm(x.startTime), rawEnd=tm(x.endTime);
  const start=Math.min(Math.max(rawStart,DAY_START),DAY_END);
  const end=Math.min(Math.max(rawEnd,DAY_START),DAY_END);
  const minutes=Math.max(end-start,0);
  return {
    top:(start-DAY_START)/DAY_SPAN*100,
    height:minutes/DAY_SPAN*100,
    minutes
  };
}

function timeline(date){
  const dayRows=rows(date),dayLocks=locksForDate(date),ss=slots();

  let grid='';
  ss.forEach((s,i)=>{
    const a=tm(s),b=a+30;
    const eventOccupied=slotRows(date,s).length>0;
    const lockOccupied=dayLocks.some(x=>tm(x.startTime)<b&&tm(x.endTime)>a);
    const occupied=eventOccupied||lockOccupied;
    const hour=tm(s)%60===0;
    grid+=`<div class="grid-time ${hour?'is-hour':''}" style="grid-row:${i+1};grid-column:1">${s}</div>`;
    grid+=`<div class="slot-bg ${occupied?'occupied':''} ${lockOccupied?'locked-bg':''} ${hour?'is-hour':''}" style="grid-row:${i+1};grid-column:2"></div>`;
    if(!occupied)grid+=`<button type="button" class="slot-add" data-time="${s}" style="grid-row:${i+1};grid-column:2;align-self:center">点击约课</button>`;
  });

  let layer='';
  dayLocks.forEach(x=>{
    const p=place(x);
    layer+=`<div class="web-lock-card" style="top:${p.top}%;height:${p.height}%">
      <strong>已锁定 ${esc(x.startTime)}–${esc(x.endTime)}</strong>
      <small>${x.repeatWeekly?'每周固定 · ':''}${esc(x.notes||'该时段不可约')}</small>
    </div>`;
  });
  dayRows.forEach(x=>{
    const p=place(x);
    /* 同一时段还有其他课，说明数据层存在冲突，给红色标记 */
    const conflict=dayRows.some(y=>y.id!==x.id&&intervalsOverlap(x,y));
    layer+=card(x,p,conflict);
  });

  layer+=nowLine(date);

  return `<div class="timeline">
    <div class="timeline-grid">${grid}</div>
    <div class="timeline-layer">${layer}</div>
  </div>
  <div class="timeline-end"><span>${mt(DAY_END)}</span></div>`;
}

/* 只在今天显示当前时间线 */
function nowLine(date){
  if(date!==today())return '';
  const now=new Date();
  const minutes=now.getHours()*60+now.getMinutes();
  if(minutes<DAY_START||minutes>DAY_END)return '';
  const top=(minutes-DAY_START)/DAY_SPAN*100;
  return `<div class="now-line" style="top:${top}%"><time>${mt(minutes)}</time></div>`;
}

function card(x,p,conflict=false){
  const leave=x.attendanceStatus==='leave';
  const detail=contentFor(x.id,x.occurrenceDate);
  const hasContent=!!(detail?.tests?.length||detail?.training?.length);
  const label=leave?'已请假':(isTrial(x)?'首次体验':(kind(x)==='temporary'?'临时约课':'固定课'));

  /* 三行信息的可读性取决于卡片实际高度，不足一小时只保留时间与姓名 */
  const compact=p.minutes<60;
  const metaParts=[label, x.type||'综合'];
  if(hasContent)metaParts.push('已安排内容');

  return `<div class="course ${eventClass(x)} ${compact?'compact':''} ${conflict?'has-conflict':''}"
      style="top:${p.top}%;height:${p.height}%"
      data-id="${x.id}" data-date="${x.occurrenceDate}"
      role="button" tabindex="0"
      aria-label="${esc(x.startTime)} 至 ${esc(x.endTime)}，${esc(scheduleDisplayName(x))}">
    <span class="course-time">${esc(x.startTime)}–${esc(x.endTime)}</span>
    <span class="course-name">${esc(scheduleDisplayName(x))}</span>
    <span class="course-meta"><i></i>${metaParts.map(esc).join(' · ')}</span>
    <button type="button" class="course-more" data-more="${x.id}" data-date="${x.occurrenceDate}" aria-label="更多操作" aria-expanded="false" aria-haspopup="menu">⋯</button>
  </div>`;
}

/* ── 课程卡交互：主卡看内容，更多菜单处理编辑/请假/取消 ── */
let openMenuId=null;
function closeMenu(){
  const m=document.getElementById('courseMenu');
  if(m)m.remove();
  document.querySelectorAll('.course-more[aria-expanded="true"]').forEach(b=>b.setAttribute('aria-expanded','false'));
  openMenuId=null;
}
function openMenu(btn){
  const id=btn.dataset.more, date=btn.dataset.date;
  if(openMenuId===id){closeMenu();return}
  closeMenu();
  openMenuId=id;
  btn.setAttribute('aria-expanded','true');

  const x=schedules.find(s=>String(s.id)===String(id));
  if(!x)return;
  const ex=exceptionFor(id,date);
  const leave=ex?.status==='leave';

  const menu=document.createElement('div');
  menu.className='course-menu';
  menu.id='courseMenu';
  menu.setAttribute('role','menu');
  menu.innerHTML=`
    <button type="button" role="menuitem" data-act="content">查看课程内容</button>
    <button type="button" role="menuitem" data-act="edit">编辑课程</button>
    <button type="button" role="menuitem" data-act="leave">${leave?'恢复本节':'标记请假'}</button>
    <hr>
    <button type="button" role="menuitem" class="is-danger" data-act="cancel">取消本节</button>`;
  document.body.appendChild(menu);

  /* fixed 定位 + 视口内翻转，确保菜单不会压住相邻课程或被裁掉 */
  const r=btn.getBoundingClientRect();
  const mw=menu.offsetWidth, mh=menu.offsetHeight;
  let left=Math.min(r.right-mw, window.innerWidth-mw-8);
  let top=r.bottom+6;
  if(top+mh>window.innerHeight-8)top=r.top-mh-6;
  menu.style.left=Math.max(8,left)+'px';
  menu.style.top=Math.max(8,top)+'px';

  menu.querySelector('[data-act="content"]').onclick=()=>{closeMenu();openContent(x,date)};
  menu.querySelector('[data-act="edit"]').onclick=()=>{closeMenu();openCourse(x)};
  menu.querySelector('[data-act="leave"]').onclick=async()=>{
    closeMenu();
    try{
      if(leave)await TrainLogCloud.deleteScheduleException(id,date);
      else await TrainLogCloud.setScheduleException(id,date,'leave');
      notify(leave?'已恢复本节':'已标记请假','ok');
      await load();
    }catch(err){notify('请假操作失败：'+err.message,'error')}
  };
  menu.querySelector('[data-act="cancel"]').onclick=async()=>{
    closeMenu();
    const ok=await askConfirm('取消本节课程',`确定取消「${scheduleDisplayName(x)}」${date} ${x.startTime}–${x.endTime} 这节课？${kind(x)==='fixed'?'固定课只取消当天这一节，后续周次不受影响。':'该临时课程会被直接删除。'}`,'确认取消');
    if(!ok)return;
    try{
      if(kind(x)==='fixed')await TrainLogCloud.setScheduleException(id,date,'cancelled');
      else await TrainLogCloud.deleteSchedule(id);
      notify('已取消本节','ok');
      await load();
    }catch(err){notify('取消课程失败：'+err.message,'error')}
  };
}

function bindCourseCards(){
  $('app').querySelectorAll('.course').forEach(el=>{
    const openIt=()=>{
      const x=schedules.find(s=>String(s.id)===String(el.dataset.id));
      if(x)openContent({...x,occurrenceDate:el.dataset.date},el.dataset.date);
    };
    el.onclick=e=>{if(e.target.closest('.course-more'))return;openIt()};
    el.onkeydown=e=>{
      if(e.key==='Enter'||e.key===' '){e.preventDefault();openIt()}
    };
  });
  $('app').querySelectorAll('.course-more').forEach(btn=>{
    btn.onclick=e=>{e.stopPropagation();openMenu(btn)};
  });
}

document.addEventListener('click',e=>{
  if(!e.target.closest('.course-menu')&&!e.target.closest('.course-more'))closeMenu();
});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeMenu()});
window.addEventListener('resize',closeMenu);
window.addEventListener('scroll',closeMenu,true);

/* ── 会员面板 ── */
function filteredMembers(){
  const q=memberSearchQuery.toLowerCase();
  return members.filter(m=>!q||memberSearchText(m).includes(q));
}
function memberList(arr){
  return arr.length?arr.map(m=>`<button type="button" class="member-edit" data-id="${m.id}">
    <strong>${esc(memberDisplayName(m))}</strong>
    <small>${esc(m.memberCode||'—')} · ${esc(m.goal||'未填写目标')}${m.contact?` · ${esc(m.contact)}`:''}</small>
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
    <button type="button" class="btn ghost member-page-btn" id="memberPrev" ${memberPage<=1?'disabled':''}>上一页</button>
    <span>${memberPage} / ${totalPages} · ${arr.length} 位</span>
    <button type="button" class="btn ghost member-page-btn" id="memberNext" ${memberPage>=totalPages?'disabled':''}>下一页</button>`;
  document.querySelectorAll('.member-edit').forEach(b=>b.onclick=()=>openMember(members.find(x=>x.id===b.dataset.id)));
  $('memberPrev').onclick=()=>{if(memberPage>1){memberPage--;renderMemberPanel()}};
  $('memberNext').onclick=()=>{if(memberPage<totalPages){memberPage++;renderMemberPanel()}};
}

/* ── 手机会员抽屉 ── */
function setMembersOpen(open){
  $('membersPanel').classList.toggle('is-open',open);
  $('scrim').hidden=!open;
  $('membersToggle').setAttribute('aria-expanded',String(open));
}
$('membersToggle').onclick=()=>setMembersOpen(!$('membersPanel').classList.contains('is-open'));
$('membersClose').onclick=()=>setMembersOpen(false);
$('scrim').onclick=()=>setMembersOpen(false);

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
  $('trialMemberNeed').value=trial?(x.trialMemberNeed||''):'';
  $('trialParentNeed').value=trial?(x.trialParentNeed||''):'';
  $('trialNotes').value=trial?(x.trialNotes||''):'';
  $('weekday').value=x?.day||wd(selected);
  $('courseDate').value=x?.date||selected;
  $('startTime').value=x?.startTime||preset||'16:00';
  $('endTime').value=x?.endTime||(preset?mt(Math.min(tm(preset)+60,1260)):'17:00');
  $('courseType').value=trial?'综合':(x?.type||'综合');
  $('notes').value=x?.notes||'';
  $('deleteBtn').classList.toggle('hidden',!x);
  const saveBtn=$('saveCourseBtn');
  saveBtn.dataset.idleLabel='保存';
  setBtnState(saveBtn,'idle','保存');
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
  const saveBtn=$('memberForm').querySelector('button[type="submit"]');
  saveBtn.dataset.idleLabel='保存会员';
  setBtnState(saveBtn,'idle','保存会员');
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
    setStatus('');
    render();
  }catch(e){
    setStatus('同步失败：'+e.message,true);
    $('app').innerHTML='<div class="empty">无法连接共享课表</div>';
  }
}

/* ══════════════ 事件绑定 ══════════════ */

$('appointmentType').onchange=toggleFields;
$('kind').onchange=toggleFields;
$('studentSearch').oninput=e=>fillMembers(e.target.value,$('studentName').value);
$('addBtn').onclick=()=>openCourse();
$('memberBtn').onclick=()=>openMember();
$('cancelCourse').onclick=()=>$('courseDialog').close();
$('cancelMember').onclick=()=>$('memberDialog').close();
$('closeContent').onclick=()=>$('contentDialog').close();
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());
$('weekday').innerHTML=WEEK.map(x=>`<option value="${x.v}">${x.s}</option>`).join('');
$('memberAge').oninput=()=>{const b=birthFromAge($('memberAge').value);if(b)$('memberBirth').value=b};
$('memberBirth').onchange=()=>{$('memberAge').value=ageFromBirth($('memberBirth').value)||''};

/* 会员搜索：面板是静态 DOM，只绑定一次，避免每次重渲染丢焦点 */
$('memberListSearch').oninput=e=>{
  memberSearchQuery=e.target.value.trim();
  memberPage=1;
  renderMemberPanel();
};

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
    trialMemberNeed:trial?$('trialMemberNeed').value.trim():'',
    trialParentNeed:trial?$('trialParentNeed').value.trim():'',
    trialNotes:trial?$('trialNotes').value.trim():'',
    notes:$('notes').value.trim()
  };
  if(!x.studentName)return notify(trial?'请输入体验学员姓名':'请选择会员','warn');
  if(x.endTime<=x.startTime)return notify('结束时间需要晚于开始时间','warn');
  if(x.kind==='temporary'&&!x.date)return notify('临时约课 / 首次体验需要日期','warn');
  const id=$('courseId').value;
  const localConflict=findConflict(x,id);
  if(localConflict)return notify(conflictMessage(localConflict),'warn');
  const localLock=findLockConflict(x);
  if(localLock)return notify(lockConflictMessage(localLock),'warn');

  courseSaving=true;
  const saveBtn=$('saveCourseBtn');
  setBtnState(saveBtn,'saving','保存中…');
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
    setBtnState(saveBtn,'ok','已保存');
    notify(id?'课程已更新':'课程已创建','ok',1800);
    setTimeout(async()=>{$('courseDialog').close();await load()},420);
  }catch(err){
    setBtnState(saveBtn,'error','保存失败');
    notify('保存失败：'+err.message,'error',4200);
    setTimeout(()=>setBtnState(saveBtn,'idle','保存'),1400);
  }finally{
    courseSaving=false;
  }
};

$('deleteBtn').onclick=async()=>{
  const id=$('courseId').value;
  if(!id)return;
  const ok=await askConfirm('删除课程','删除后该课程会从共享课表中移除，且无法撤销。固定课的后续周次也会一起删除。','删除');
  if(!ok)return;
  try{
    await TrainLogCloud.deleteSchedule(id);
    $('courseDialog').close();
    notify('课程已删除','ok');
    await load();
  }catch(err){notify('删除失败：'+err.message,'error')}
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
    memberCode:existingMember?.memberCode||'',
    profile:existingMember?.profile||{}
  };
  if(!x.name&&!x.alias)return notify('姓名或英文名/小名至少填写一项','warn');
  memberSaving=true;
  setBtnState(saveBtn,'saving','保存中…');
  try{
    const id=currentId;
    if(id)await TrainLogCloud.updateMember(id,x);
    else await TrainLogCloud.createMember(x);
    setBtnState(saveBtn,'ok','已保存');
    notify(currentId?'会员已更新':'会员已创建','ok',1800);
    setTimeout(async()=>{$('memberDialog').close();await load()},420);
  }catch(err){
    setBtnState(saveBtn,'error','保存失败');
    notify('会员保存失败：'+err.message,'error',4200);
    setTimeout(()=>setBtnState(saveBtn,'idle','保存会员'),1400);
  }finally{
    memberSaving=false;
  }
};

$('deleteMemberBtn').onclick=async()=>{
  const id=$('memberId').value;
  if(!id)return;
  const ok=await askConfirm('删除会员','删除该会员后，其档案会一并移除，且无法撤销。','删除会员');
  if(!ok)return;
  try{
    await TrainLogCloud.deleteMember(id);
    $('memberDialog').close();
    notify('会员已删除','ok');
    await load();
  }catch(err){notify('删除失败：'+err.message,'error')}
};

load();
