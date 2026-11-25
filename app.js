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
const DEFAULTS={clientGapDays:21,inquiryGapDays:2,followUpChips:[1,3,7,14],countryCode:'91',formLink:'',templates:[
{id:'reply',label:'Reply to inquiry',for:'inquiry',text:"Hi {name}, thanks for reaching out to Namaste Psychology. I'd be happy to help. Could you tell me a little about what you're looking for, and when you're usually free for a short call?"},
{id:'formsend',label:'Send form',for:'inquiry',text:"Hi {name}, please fill in this short form so I can understand your needs before we speak: {form}"},
{id:'formremind',label:'Form reminder',for:'inquiry',text:"Hi {name}, a gentle reminder to fill in the intake form when you get a moment: {form}. Let me know if you have any questions."},
{id:'discovery',label:'Discovery call',for:'inquiry',text:"Hi {name}, would you like to set up a short discovery call? Share a couple of times that work for you and I'll confirm."},
{id:'inqfollow',label:'Follow up on inquiry',for:'inquiry',text:"Hi {name}, following up on your inquiry. Are you still looking to start therapy? Happy to answer any questions."},
{id:'checkin',label:'Check in',for:'client',text:"Hi {name}, it has been a little while since our last session. Would you like to book your next one? I have a few slots open this week."},
{id:'remind',label:'Session reminder',for:'client',text:"Hi {name}, a reminder about our upcoming session. Please let me know if you need to reschedule."},
{id:'resched',label:'Reschedule',for:'both',text:"Hi {name}, I need to reschedule our session. Would any of these work for you? Let me know and I'll confirm."}
]};

let db={people:[],settings:{...DEFAULTS}};
let cfg=JSON.parse(localStorage.getItem('desk_cfg')||'{}'); // {token,repo:"owner/name",path}
let sha=null,tab='today',query='',saveT=null,dirty=false;

/* ---------- storage / sync ---------- */
const b64e=s=>btoa(unescape(encodeURIComponent(s)));
const b64d=s=>decodeURIComponent(escape(atob(s.replace(/\n/g,''))));
const api=(m,body)=>fetch(`https://api.github.com/repos/${cfg.repo}/contents/${cfg.path||'data.json'}${m==='GET'?'?ts='+Date.now():''}`,{method:m,headers:{Authorization:'Bearer '+cfg.token,Accept:'application/vnd.github+json'},body:body?JSON.stringify(body):undefined});
function setSync(c,t){const e=$('#sync');e.className='sync '+c;e.querySelector('span').textContent=t}
function normalize(d){d=d||{};d.people=d.people||[];const st=d.settings||{};d.settings={...DEFAULTS,...st,templates:st.templates||DEFAULTS.templates.map(t=>({...t}))};return d}
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
const WA_SVG='<svg viewBox="0 0 24 24"><path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.16-.17.2-.35.22-.64.07-.3-.15-1.26-.46-2.4-1.48-.89-.8-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.14-.13.3-.35.45-.52.15-.18.2-.3.3-.5.1-.2.05-.38-.02-.53-.08-.15-.67-1.62-.92-2.2-.24-.59-.49-.51-.67-.51h-.57c-.2 0-.52.08-.8.38-.27.3-1.04 1.02-1.04 2.48s1.07 2.87 1.22 3.07c.15.2 2.1 3.2 5.08 4.48.71.3 1.26.49 1.7.63.71.23 1.36.2 1.87.12.57-.08 1.76-.72 2-1.41.25-.7.25-1.29.17-1.41-.07-.13-.27-.2-.57-.35M12.05 21.8a9.87 9.87 0 0 1-5.03-1.38l-.36-.21-3.74.98 1-3.65-.24-.37a9.86 9.86 0 0 1-1.51-5.26c0-5.45 4.44-9.88 9.89-9.88 2.64 0 5.12 1.03 6.99 2.9a9.83 9.83 0 0 1 2.89 6.99c0 5.45-4.44 9.88-9.89 9.88M20.46 3.49A11.82 11.82 0 0 0 12.05 0C5.5 0 .16 5.34.16 11.89c0 2.1.55 4.14 1.59 5.95L.06 24l6.3-1.65a11.88 11.88 0 0 0 5.69 1.45c6.55 0 11.89-5.34 11.89-11.89 0-3.18-1.24-6.17-3.48-8.41"/></svg>';
const waNum=p=>{let n=(p.whatsapp||(/^[+\d][\d\s-]{7,}$/.test(p.contact||'')?p.contact:'')).replace(/\D/g,'');if(!n)return'';if(n.length===11&&n[0]==='0')n=n.slice(1);if(n.length===10)n=db.settings.countryCode+n;return n};
const tplFor=p=>db.settings.templates.filter(t=>t.for==='both'||t.for===p.type);
const msg=(p,t)=>t.text.replace(/\{name\}/g,p.name.trim().split(/\s+/)[0]).replace(/\{form\}/g,db.settings.formLink||'[form link]');
const waLink=(p,t)=>{const n=waNum(p);return n&&t?`https://wa.me/${n}?text=${encodeURIComponent(msg(p,t))}`:''};
function defaultTpl(p){const id=p.type==='client'?'checkin':p.status==='new'?'reply':p.status==='form_sent'?'formremind':'inqfollow';return db.settings.templates.find(t=>t.id===id)||tplFor(p)[0]}
function logWA(id,tid){const p=db.people.find(x=>x.id===id),t=db.settings.templates.find(x=>x.id===tid);if(!p||!t)return;p.lastContact=todayStr();if(p.type==='inquiry'&&p.status==='new')p.status='replied';if(tid==='formsend')p.status='form_sent';addLog(p,'WhatsApp: '+t.label);touch(p);queueSave();render()}
function addLog(p,t){p.log=p.log||[];p.log.unshift({d:todayStr(),t});}

/* ---------- render ---------- */
function rowHTML(p,why,cls){
  const st=p.type==='inquiry'?INQ_STATUS[p.status]:CL_STATUS[p.status];
  const t=defaultTpl(p),l=waLink(p,t);
  return `<div class="row" role="button" tabindex="0" data-id="${p.id}"><div class="av ${p.type==='inquiry'?'inq':''}">${esc(initials(p.name))}</div><div class="mid"><div class="nm">${esc(p.name)}</div><div class="why ${cls||''}">${esc(why)}</div></div>${why===st?'':`<span class="pill">${esc(st)}</span>`}${l?`<a class="wa" href="${l}" target="_blank" rel="noopener" data-wa="${p.id}" data-tid="${t.id}" aria-label="WhatsApp: ${esc(t.label)}" title="${esc(t.label)}">${WA_SVG}</a>`:''}</div>`;
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
  <div class="g2"><div><label>WhatsApp number</label><input id="w" inputmode="tel" autocomplete="off" placeholder="98765 43210"></div><div><label>Source</label><select id="s">${SOURCES.map(s=>`<option>${s}</option>`).join('')}</select></div></div>
  <label>Email or other contact</label><input id="c" autocomplete="off">
  <label>Note</label><textarea id="no" placeholder="What did they ask for?"></textarea>`);
  let type='inquiry';
  document.querySelectorAll('#tp button').forEach(b=>b.onclick=()=>{type=b.dataset.v;document.querySelectorAll('#tp button').forEach(x=>x.classList.toggle('on',x===b))});
  setTimeout(()=>$('#n').focus(),300);
  $('#save').onclick=()=>{
    const name=$('#n').value.trim();if(!name){$('#n').focus();return}
    const t=todayStr();
    const p={id:uid(),name,whatsapp:$('#w').value.trim(),contact:$('#c').value.trim(),source:$('#s').value,type,status:type==='inquiry'?'new':'active',notes:'',created:new Date().toISOString(),lastContact:t,lastSession:'',followUp:'',log:[],updatedAt:Date.now()};
    const note=$('#no').value.trim();if(note)addLog(p,note);
    db.people.push(p);queueSave();closeSheet();tab=type;render();toast('Added')
  };
}

function personSheet(id){
  const p=db.people.find(x=>x.id===id);if(!p)return;
  const inq=p.type==='inquiry',t=todayStr(),a=attention(p);
  openSheet(`<div class="sh-h"><button class="txt" id="x">Done</button><h3>${esc(p.name)}</h3><span style="width:44px"></span></div>
  ${a?`<div class="why ${a.lvl===2?'red':'or'}" style="text-align:center;margin-bottom:6px">${esc(a.why)}</div>`:''}
  <div class="why" style="text-align:center;margin-bottom:4px">${[p.whatsapp,p.contact,p.source].filter(Boolean).map(esc).join(', ')}</div>
  <div class="btns">
    <button class="b p" data-a="contacted">Contacted today</button>
    ${inq?'':'<button class="b p" data-a="session">Session done</button>'}
    ${inq&&p.status!=='converted'?'<button class="b" data-a="convert">Became client</button>':''}
  </div>
  <label>Message on WhatsApp</label>
  ${waNum(p)?`<div class="chips">${tplFor(p).map(t=>`<a class="chip wal" href="${waLink(p,t)}" target="_blank" rel="noopener" data-tid="${t.id}">${esc(t.label)}</a>`).join('')}</div>`:'<div class="why">Add a WhatsApp number below, then reopen.</div>'}
  <label>Follow up on</label>
  <div class="chips">${db.settings.followUpChips.map(n=>`<button class="chip ${p.followUp===addDays(t,n)?'on':''}" data-fu="${n}">${n===1?'Tomorrow':n+' days'}</button>`).join('')}<button class="chip ${p.followUp?'':'on'}" data-fu="0">None</button></div>
  <div class="g2"><div><label>Date</label><input type="date" id="fu" value="${p.followUp||''}"></div><div><label>Status</label><select id="st">${opts(inq?INQ_STATUS:CL_STATUS)}</select></div></div>
  <div class="g2"><div><label>Name</label><input id="en" value="${esc(p.name)}"></div><div><label>WhatsApp number</label><input id="ew" inputmode="tel" value="${esc(p.whatsapp||'')}"></div></div>
  <label>Email or other contact</label><input id="ec" value="${esc(p.contact)}">
  ${inq?'':`<label>Last session</label><input type="date" id="ls" value="${p.lastSession||''}">`}
  <label>Notes</label><textarea id="nt">${esc(p.notes)}</textarea>
  <label>Log</label><div class="g2" style="grid-template-columns:1fr auto"><input id="lg" placeholder="Add an entry" autocomplete="off"><button class="b" id="la">Add</button></div>
  <div class="log">${(p.log||[]).map(l=>`<div>${esc(l.t)}<small>${fmt(l.d)}</small></div>`).join('')}</div>
  <div style="text-align:center;margin-top:18px"><button class="txt dn" id="del">Delete</button></div>`);
  $('#st').value=p.status;
  const commit=(msg)=>{touch(p);queueSave();render();if(msg)toast(msg)};
  const save=()=>{p.name=$('#en').value.trim()||p.name;p.contact=$('#ec').value.trim();p.whatsapp=$('#ew').value.trim();p.notes=$('#nt').value;p.status=$('#st').value;p.followUp=$('#fu').value;if($('#ls'))p.lastSession=$('#ls').value;touch(p);queueSave();render()};
  $('#x').onclick=()=>{save();closeSheet()};
  $('#sheet').querySelectorAll('[data-a]').forEach(b=>b.onclick=()=>{
    const k=b.dataset.a;
    if(k==='contacted'){p.lastContact=t;if(p.status==='new')p.status='replied';addLog(p,'Contacted');if(p.followUp&&p.followUp<=t)p.followUp=''}
    if(k==='session'){p.lastSession=t;p.lastContact=t;p.followUp='';addLog(p,'Session held')}
    if(k==='convert'){p.type='client';p.status='active';p.followUp='';addLog(p,'Became client');tab='client'}
    save();closeSheet();toast(k==='convert'?'Moved to Clients':'Updated');
  });
  $('#sheet').querySelectorAll('[data-fu]').forEach(b=>b.onclick=()=>{const n=+b.dataset.fu;p.followUp=n?addDays(t,n):'';save();closeSheet();toast(n?'Follow up '+fmt(p.followUp):'Follow-up cleared')});
  $('#sheet').querySelectorAll('.wal').forEach(a=>a.onclick=()=>{save();const tid=a.dataset.tid;a.href=waLink(p,db.settings.templates.find(t=>t.id===tid))||a.href;setTimeout(()=>{logWA(id,tid);personSheet(id)},50)});
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
  <div class="g2"><div><label>Default country code</label><input id="cc" inputmode="numeric" value="${esc(S.countryCode)}"></div><div><label>Intake form link</label><input id="fl" value="${esc(S.formLink)}" autocapitalize="off" placeholder="https://"></div></div>
  <label>WhatsApp templates. Use {name} for first name and {form} for the form link.</label>
  ${S.templates.map((t,i)=>`<div class="why" style="margin:10px 4px 4px">${esc(t.label)}</div><textarea data-ti="${i}">${esc(t.text)}</textarea>`).join('')}
  <div class="btns"><button class="b" id="ex">Export backup</button><button class="b" id="im">Import backup</button></div>
  <div class="why" style="margin-top:12px">Token stays in this browser only. Data is saved as one JSON file in your private repo.</div>`);
  $('#x').onclick=closeSheet;
  $('#ok').onclick=async()=>{
    cfg={repo:$('#rp').value.trim(),path:$('#pa').value.trim()||'data.json',token:$('#tk').value.trim()};
    localStorage.setItem('desk_cfg',JSON.stringify(cfg));
    db.settings.clientGapDays=+$('#cg').value||21;db.settings.inquiryGapDays=+$('#ig').value||2;db.settings.countryCode=$('#cc').value.replace(/\D/g,'')||'91';db.settings.formLink=$('#fl').value.trim();document.querySelectorAll('[data-ti]').forEach(x=>{db.settings.templates[+x.dataset.ti].text=x.value});
    closeSheet();await pull();queueSave();render();
  };
  $('#ex').onclick=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(db,null,1)],{type:'application/json'}));a.download='desk-backup-'+todayStr()+'.json';a.click()};
  $('#im').onclick=()=>{const f=document.createElement('input');f.type='file';f.accept='.json';f.onchange=async()=>{try{db=normalize(JSON.parse(await f.files[0].text()));queueSave();closeSheet();render();toast('Imported')}catch(e){toast('Invalid file')}};f.click()};
}

/* ---------- events ---------- */
$('#seg').onclick=e=>{const b=e.target.closest('button');if(b){tab=b.dataset.t;render()}};
$('#main').onclick=e=>{const w=e.target.closest('.wa');if(w){const id=w.dataset.wa,tid=w.dataset.tid;setTimeout(()=>logWA(id,tid),50);return}const r=e.target.closest('.row'),s=e.target.closest('[data-go]');if(r)personSheet(r.dataset.id);else if(s){tab=s.dataset.go;render()}};
$('#main').onkeydown=e=>{if(e.key==='Enter'&&e.target.classList.contains('row'))personSheet(e.target.dataset.id)};
$('#fab').onclick=addSheet;
$('#scrim').onclick=()=>{closeSheet()};
$('#sync').onclick=settingsSheet;
document.addEventListener('visibilitychange',async()=>{if(!document.hidden&&cfg.token&&!dirty){await pull();render()}});
addEventListener('beforeunload',e=>{if(dirty&&cfg.token){e.preventDefault();e.returnValue=''}});

(async()=>{await pull();render();if(!cfg.token&&!db.people.length)setTimeout(()=>toast('Tap Local to connect your private repo'),600)})();
