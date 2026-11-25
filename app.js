const $=s=>document.querySelector(s);
const DAY=864e5;
const todayStr=()=>{const d=new Date();return new Date(d-d.getTimezoneOffset()*6e4).toISOString().slice(0,10)};
const toD=s=>s?new Date(s+'T00:00:00'):null;
const diff=(a,b)=>Math.round((toD(a)-toD(b))/DAY);
const addDays=(s,n)=>{const d=toD(s);d.setDate(d.getDate()+n);return new Date(d-d.getTimezoneOffset()*6e4).toISOString().slice(0,10)};
const fmt=s=>s?toD(s).toLocaleDateString('en-IN',{day:'numeric',month:'short'}):'';
const uid=()=>Math.random().toString(36).slice(2,10);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const INQ_STATUS={new:'New, no reply yet',replied:'Replied',form_sent:'Form sent',form_filled:'Form filled',call_booked:'Call booked',converted:'Became client',dropped:'Dropped'};
const CL_STATUS={active:'Active',paused:'Paused',ended:'Ended'};
const SOURCES=['WhatsApp','Instagram','Email','Call','Website','Referral','Other'];
const DEFAULTS={clientGapDays:21,inquiryGapDays:2,followUpChips:[1,3,7,14]};

let db={people:[],settings:{...DEFAULTS}};
let cfg=JSON.parse(localStorage.getItem('desk_cfg')||'{}'); // {token,repo:"owner/name",path}
let sha=null,tab='today',query='',saveT=null,dirty=false;

/* ---------- storage / sync ---------- */
const b64e=s=>btoa(unescape(encodeURIComponent(s)));
const b64d=s=>decodeURIComponent(escape(atob(s.replace(/\n/g,''))));
const api=(m,body)=>fetch(`https://api.github.com/repos/${cfg.repo}/contents/${cfg.path||'data.json'}${m==='GET'?'?ts='+Date.now():''}`,{method:m,headers:{Authorization:'Bearer '+cfg.token,Accept:'application/vnd.github+json'},body:body?JSON.stringify(body):undefined});
function setSync(c,t){const e=$('#sync');e.className='sync '+c;e.querySelector('span').textContent=t}
function normalize(d){d=d||{};d.people=d.people||[];d.settings={...DEFAULTS,...(d.settings||{})};return d}
function merge(remote,local){const m=new Map(remote.people.map(p=>[p.id,p]));local.people.forEach(p=>{const r=m.get(p.id);if(!r||(p.updatedAt||0)>(r.updatedAt||0))m.set(p.id,p)});return{people:[...m.values()],settings:local.settings}}
async function pull(){
  if(!cfg.token||!cfg.repo){db=normalize(JSON.parse(localStorage.getItem('desk_db')||'null'));setSync('','Local');return}
  setSync('busy','Syncing');
  try{
    const r=await api('GET');
    if(r.status===404){sha=null;db=normalize(JSON.parse(localStorage.getItem('desk_db')||'null'));setSync('ok','Synced');if(db.people.length)queueSave();return}
    if(!r.ok)throw new Error(r.status);
    const j=await r.json();sha=j.sha;
    const remote=normalize(JSON.parse(b64d(j.content)));
    const cached=JSON.parse(localStorage.getItem('desk_db')||'null');
    db=dirty&&cached?merge(remote,normalize(cached)):remote;
    localStorage.setItem('desk_db',JSON.stringify(db));setSync('ok','Synced');
  }catch(e){db=normalize(JSON.parse(localStorage.getItem('desk_db')||'null'));setSync('err','Offline')}
}
function queueSave(){
  localStorage.setItem('desk_db',JSON.stringify(db));dirty=true;
  if(!cfg.token)return;
  setSync('busy','Saving');clearTimeout(saveT);saveT=setTimeout(push,900);
}
async function push(retry=0){
  try{
    const body={message:'update '+new Date().toISOString(),content:b64e(JSON.stringify(db,null,1))};
    if(sha)body.sha=sha;
    const r=await api('PUT',body);
    if(r.status===409||r.status===422){
      if(retry>2)throw new Error('conflict');
      const g=await api('GET');const j=await g.json();sha=j.sha;
      db=merge(normalize(JSON.parse(b64d(j.content))),db);return push(retry+1);
    }
    if(!r.ok)throw new Error(r.status);
    sha=(await r.json()).content.sha;dirty=false;setSync('ok','Synced');render();
  }catch(e){setSync('err','Not saved');toast('Save failed. Will retry on next change.')}
}

/* ---------- logic ---------- */
const isOpenInq=p=>p.type==='inquiry'&&!['converted','dropped'].includes(p.status);
const isActiveCl=p=>p.type==='client'&&p.status==='active';
function attention(p){
  const t=todayStr();
  if(!(isOpenInq(p)||isActiveCl(p)))return null;
  const S=db.settings;
  if(p.followUp&&p.followUp<=t){const n=diff(t,p.followUp);return{lvl:n>0?2:1,why:n>0?`Follow-up overdue by ${n}d`:'Follow-up today',n:n+100}}
  if(p.followUp)return null;
  if(p.type==='inquiry'){
    if(p.status==='new'){const n=diff(t,(p.created||t).slice(0,10));return{lvl:n>=1?2:1,why:n>=1?`No reply sent for ${n}d`:'Needs a reply',n:n+50}}
    const n=diff(t,p.lastContact||(p.created||t).slice(0,10));
    if(n>=S.inquiryGapDays){
      const w=p.status==='form_sent'?'Form not filled':p.status==='call_booked'?'Call booked':'Gone quiet';
      return{lvl:2,why:`${w}, last contact ${n}d ago`,n}
    }
  }else{
    const ref=p.lastSession||p.lastContact;
    if(!ref)return{lvl:1,why:'No session on record',n:1};
    const n=diff(t,ref);
    if(n>=S.clientGapDays)return{lvl:2,why:`No session in ${n} days`,n}
  }
  return null;
}
const initials=n=>n.trim().split(/\s+/).slice(0,2).map(w=>w[0]).join('').toUpperCase()||'?';
function touch(p){p.updatedAt=Date.now()}
function addLog(p,t){p.log=p.log||[];p.log.unshift({d:todayStr(),t});}

/* ---------- render ---------- */
function rowHTML(p,why,cls){
  const st=p.type==='inquiry'?INQ_STATUS[p.status]:CL_STATUS[p.status];
  return `<button class="row" data-id="${p.id}"><div class="av ${p.type==='inquiry'?'inq':''}">${esc(initials(p.name))}</div><div class="mid"><div class="nm">${esc(p.name)}</div><div class="why ${cls||''}">${esc(why)}</div></div>${why===st?'':`<span class="pill">${esc(st)}</span>`}</button>`;
}
function render(){
  const t=todayStr(),S=db.settings;
  const att=db.people.map(p=>({p,a:attention(p)})).filter(x=>x.a).sort((a,b)=>b.a.lvl-a.a.lvl||b.a.n-a.a.n);
  $('#title').textContent={today:'Today',inquiry:'Inquiries',client:'Clients'}[tab];
  $('#sub').textContent=new Date().toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long'});
  document.querySelectorAll('#seg button').forEach(b=>b.classList.toggle('on',b.dataset.t===tab));
  let h='';
  if(tab==='today'){
    const nNew=db.people.filter(p=>isOpenInq(p)&&p.status==='new').length;
    const nForm=db.people.filter(p=>isOpenInq(p)&&p.status==='form_sent').length;
    const nLapsed=db.people.filter(p=>isActiveCl(p)&&!p.followUp&&attention(p)).length;
    h+=`<div class="stats"><button class="stat ${nNew?'hot':''}" data-go="inquiry"><b>${nNew}</b><span>Awaiting reply</span></button><button class="stat" data-go="inquiry"><b>${nForm}</b><span>Form pending</span></button><button class="stat" data-go="client"><b>${nLapsed}</b><span>Not booked in</span></button></div>`;
    h+='<h2>Needs follow-up</h2>';
    h+=att.length?`<div class="list">${att.map(x=>rowHTML(x.p,x.a.why,x.a.lvl===2?'red':'or')).join('')}</div>`:'<div class="list"><div class="empty">Nobody needs a nudge right now.</div></div>';
    const up=db.people.filter(p=>(isOpenInq(p)||isActiveCl(p))&&p.followUp&&p.followUp>t).sort((a,b)=>a.followUp.localeCompare(b.followUp)).slice(0,6);
    if(up.length)h+=`<h2>Coming up</h2><div class="list">${up.map(p=>rowHTML(p,'Follow up '+fmt(p.followUp))).join('')}</div>`;
  }else{
    h+=`<input class="search" id="q" type="search" placeholder="Search name, number, notes" value="${esc(query)}">`;
    const q=query.toLowerCase();
    let ps=db.people.filter(p=>p.type===tab&&(!q||[p.name,p.contact,p.notes].join(' ').toLowerCase().includes(q)));
    const groups=tab==='inquiry'?[['Open',p=>isOpenInq(p)],['Closed',p=>!isOpenInq(p)]]:[['Active',p=>p.status==='active'],['Paused or ended',p=>p.status!=='active']];
    groups.forEach(([name,fn])=>{
      const g=ps.filter(fn).sort((a,b)=>{const A=attention(a),B=attention(b);return (B?B.lvl:0)-(A?A.lvl:0)||(b.updatedAt||0)-(a.updatedAt||0)});
      if(!g.length)return;
      h+=`<h2>${name} (${g.length})</h2><div class="list">${g.map(p=>{const a=attention(p);const st=tab==='inquiry'?INQ_STATUS[p.status]:(p.lastSession?'Last session '+fmt(p.lastSession):CL_STATUS[p.status]);return rowHTML(p,a?a.why:st,a?(a.lvl===2?'red':'or'):'')}).join('')}</div>`;
    });
    if(!ps.length)h+=`<div class="list"><div class="empty">${q?'No matches.':'Nothing here yet. Tap + to add someone.'}</div></div>`;
  }
  $('#main').innerHTML=h;
  const qi=$('#q');if(qi){qi.oninput=e=>{query=e.target.value;const pos=e.target.selectionStart;render();const n=$('#q');n.focus();n.setSelectionRange(pos,pos)}}
}

/* ---------- sheet ---------- */
function openSheet(html){$('#sheet').innerHTML='<div class="grab"></div>'+html;$('#scrim').classList.add('on');requestAnimationFrame(()=>$('#sheet').classList.add('on'))}
function closeSheet(){$('#sheet').classList.remove('on');$('#scrim').classList.remove('on')}
function toast(t){const e=$('#toast');e.textContent=t;e.classList.add('on');clearTimeout(toast.t);toast.t=setTimeout(()=>e.classList.remove('on'),1800)}
const opts=o=>Object.entries(o).map(([k,v])=>`<option value="${k}">${v}</option>`).join('');

function addSheet(){
  openSheet(`<div class="sh-h"><button class="txt" onclick="closeSheet()">Cancel</button><h3>New</h3><button class="txt" id="save"><b>Add</b></button></div>
  <div class="seg" id="tp" style="margin:10px 0 0"><button data-v="inquiry" class="on">Inquiry</button><button data-v="client">Client</button></div>
  <label>Name</label><input id="n" autocomplete="off" placeholder="Full name">
  <div class="g2"><div><label>Phone or email</label><input id="c" inputmode="tel" autocomplete="off"></div><div><label>Source</label><select id="s">${SOURCES.map(s=>`<option>${s}</option>`).join('')}</select></div></div>
  <label>Note</label><textarea id="no" placeholder="What did they ask for?"></textarea>`);
  let type='inquiry';
  document.querySelectorAll('#tp button').forEach(b=>b.onclick=()=>{type=b.dataset.v;document.querySelectorAll('#tp button').forEach(x=>x.classList.toggle('on',x===b))});
  setTimeout(()=>$('#n').focus(),300);
  $('#save').onclick=()=>{
    const name=$('#n').value.trim();if(!name){$('#n').focus();return}
    const t=todayStr();
    const p={id:uid(),name,contact:$('#c').value.trim(),source:$('#s').value,type,status:type==='inquiry'?'new':'active',notes:'',created:new Date().toISOString(),lastContact:t,lastSession:'',followUp:'',log:[],updatedAt:Date.now()};
    const note=$('#no').value.trim();if(note)addLog(p,note);
    db.people.push(p);queueSave();closeSheet();tab=type;render();toast('Added')
  };
}

function personSheet(id){
  const p=db.people.find(x=>x.id===id);if(!p)return;
  const inq=p.type==='inquiry',t=todayStr(),a=attention(p);
  const wa=p.contact&&/^[+\d][\d\s-]{7,}$/.test(p.contact)?`https://wa.me/${p.contact.replace(/[^\d]/g,'').replace(/^(\d{10})$/,'91$1')}`:'';
  openSheet(`<div class="sh-h"><button class="txt" id="x">Done</button><h3>${esc(p.name)}</h3><span style="width:44px"></span></div>
  ${a?`<div class="why ${a.lvl===2?'red':'or'}" style="text-align:center;margin-bottom:6px">${esc(a.why)}</div>`:''}
  <div style="text-align:center;margin-bottom:4px">${p.contact?`<a class="lnk" href="${wa||(p.contact.includes('@')?'mailto:'+esc(p.contact):'tel:'+esc(p.contact))}" target="_blank" rel="noopener">${esc(p.contact)}</a>`:''}<span class="why" style="display:inline"> ${p.source?'· '+esc(p.source):''}</span></div>
  <div class="btns">
    <button class="b p" data-a="contacted">Contacted today</button>
    ${inq?'':'<button class="b p" data-a="session">Session done</button>'}
    ${inq&&p.status!=='converted'?'<button class="b" data-a="convert">Became client</button>':''}
  </div>
  <label>Follow up on</label>
  <div class="chips">${db.settings.followUpChips.map(n=>`<button class="chip ${p.followUp===addDays(t,n)?'on':''}" data-fu="${n}">${n===1?'Tomorrow':n+' days'}</button>`).join('')}<button class="chip ${p.followUp?'':'on'}" data-fu="0">None</button></div>
  <div class="g2"><div><label>Date</label><input type="date" id="fu" value="${p.followUp||''}"></div><div><label>Status</label><select id="st">${opts(inq?INQ_STATUS:CL_STATUS)}</select></div></div>
  <div class="g2"><div><label>Name</label><input id="en" value="${esc(p.name)}"></div><div><label>Phone or email</label><input id="ec" value="${esc(p.contact)}"></div></div>
  ${inq?'':`<label>Last session</label><input type="date" id="ls" value="${p.lastSession||''}">`}
  <label>Notes</label><textarea id="nt">${esc(p.notes)}</textarea>
  <label>Log</label><div class="g2" style="grid-template-columns:1fr auto"><input id="lg" placeholder="Add an entry" autocomplete="off"><button class="b" id="la">Add</button></div>
  <div class="log">${(p.log||[]).map(l=>`<div>${esc(l.t)}<small>${fmt(l.d)}</small></div>`).join('')}</div>
  <div style="text-align:center;margin-top:18px"><button class="txt dn" id="del">Delete</button></div>`);
  $('#st').value=p.status;
  const commit=(msg)=>{touch(p);queueSave();render();if(msg)toast(msg)};
  const save=()=>{p.name=$('#en').value.trim()||p.name;p.contact=$('#ec').value.trim();p.notes=$('#nt').value;p.status=$('#st').value;p.followUp=$('#fu').value;if($('#ls'))p.lastSession=$('#ls').value;touch(p);queueSave();render()};
  $('#x').onclick=()=>{save();closeSheet()};
  $('#sheet').querySelectorAll('[data-a]').forEach(b=>b.onclick=()=>{
    const k=b.dataset.a;
    if(k==='contacted'){p.lastContact=t;if(p.status==='new')p.status='replied';addLog(p,'Contacted');if(p.followUp&&p.followUp<=t)p.followUp=''}
    if(k==='session'){p.lastSession=t;p.lastContact=t;p.followUp='';addLog(p,'Session held')}
    if(k==='convert'){p.type='client';p.status='active';p.followUp='';addLog(p,'Became client');tab='client'}
    save();closeSheet();toast(k==='convert'?'Moved to Clients':'Updated');
  });
  $('#sheet').querySelectorAll('[data-fu]').forEach(b=>b.onclick=()=>{const n=+b.dataset.fu;p.followUp=n?addDays(t,n):'';save();closeSheet();toast(n?'Follow up '+fmt(p.followUp):'Follow-up cleared')});
  $('#la').onclick=()=>{const v=$('#lg').value.trim();if(!v)return;save();addLog(p,v);commit();personSheet(id)};
  $('#del').onclick=()=>{if(confirm('Delete '+p.name+'? This cannot be undone.')){db.people=db.people.filter(x=>x.id!==id);queueSave();closeSheet();render()}};
}

function settingsSheet(){
  const S=db.settings;
  openSheet(`<div class="sh-h"><button class="txt" id="x">Cancel</button><h3>Settings</h3><button class="txt" id="ok"><b>Save</b></button></div>
  <label>Private data repo (owner/name)</label><input id="rp" placeholder="armeet/desk-data" value="${esc(cfg.repo||'')}" autocapitalize="off">
  <label>File path</label><input id="pa" value="${esc(cfg.path||'data.json')}" autocapitalize="off">
  <label>GitHub token (fine-grained, Contents read and write, that repo only)</label><input id="tk" type="password" placeholder="github_pat_..." value="${esc(cfg.token||'')}" autocomplete="off">
  <div class="g2"><div><label>Flag clients after (days)</label><input id="cg" type="number" min="1" value="${S.clientGapDays}"></div><div><label>Flag inquiries after (days)</label><input id="ig" type="number" min="1" value="${S.inquiryGapDays}"></div></div>
  <div class="btns"><button class="b" id="ex">Export backup</button><button class="b" id="im">Import backup</button></div>
  <div class="why" style="margin-top:12px">Token stays in this browser only. Data is saved as one JSON file in your private repo.</div>`);
  $('#x').onclick=closeSheet;
  $('#ok').onclick=async()=>{
    cfg={repo:$('#rp').value.trim(),path:$('#pa').value.trim()||'data.json',token:$('#tk').value.trim()};
    localStorage.setItem('desk_cfg',JSON.stringify(cfg));
    db.settings.clientGapDays=+$('#cg').value||21;db.settings.inquiryGapDays=+$('#ig').value||2;
    closeSheet();await pull();queueSave();render();
  };
  $('#ex').onclick=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(db,null,1)],{type:'application/json'}));a.download='desk-backup-'+todayStr()+'.json';a.click()};
  $('#im').onclick=()=>{const f=document.createElement('input');f.type='file';f.accept='.json';f.onchange=async()=>{try{db=normalize(JSON.parse(await f.files[0].text()));queueSave();closeSheet();render();toast('Imported')}catch(e){toast('Invalid file')}};f.click()};
}

/* ---------- events ---------- */
$('#seg').onclick=e=>{const b=e.target.closest('button');if(b){tab=b.dataset.t;render()}};
$('#main').onclick=e=>{const r=e.target.closest('.row'),s=e.target.closest('[data-go]');if(r)personSheet(r.dataset.id);else if(s){tab=s.dataset.go;render()}};
$('#fab').onclick=addSheet;
$('#scrim').onclick=()=>{closeSheet()};
$('#sync').onclick=settingsSheet;
document.addEventListener('visibilitychange',async()=>{if(!document.hidden&&cfg.token&&!dirty){await pull();render()}});
addEventListener('beforeunload',e=>{if(dirty&&cfg.token){e.preventDefault();e.returnValue=''}});

(async()=>{await pull();render();if(!cfg.token&&!db.people.length)setTimeout(()=>toast('Tap Local to connect your private repo'),600)})();
