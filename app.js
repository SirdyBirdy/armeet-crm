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
let onDismiss=()=>{},selId=null;
let pass=sessionStorage.getItem('desk_pass')||'',keyC=null,askMsg='';
let sha=null,tab='today',query='',saveT=null,dirty=false;

/* ---------- storage / sync ---------- */
const b64e=s=>btoa(unescape(encodeURIComponent(s)));
const b64d=s=>decodeURIComponent(escape(atob(s.replace(/\n/g,''))));
const api=(m,body)=>fetch(`https://api.github.com/repos/${cfg.repo}/contents/${cfg.path||'data.json'}${m==='GET'?'?ts='+Date.now():''}`,{method:m,headers:{Authorization:'Bearer '+cfg.token,Accept:'application/vnd.github+json'},body:body?JSON.stringify(body):undefined});
const u8=b=>{let s='';b.forEach(x=>s+=String.fromCharCode(x));return btoa(s)},fromB=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
async function deriveKey(salt){const sb=u8(salt);if(keyC&&keyC.s===sb)return keyC.k;const m=await crypto.subtle.importKey('raw',new TextEncoder().encode(pass),'PBKDF2',false,['deriveKey']);const k=await crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:250000,hash:'SHA-256'},m,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);keyC={s:sb,k};return k}
async function seal(o){const txt=JSON.stringify(o,null,1);if(!pass)return txt;const salt=keyC?fromB(keyC.s):crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12)),k=await deriveKey(salt);return JSON.stringify({enc:1,salt:u8(salt),iv:u8(iv),data:u8(new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},k,new TextEncoder().encode(txt))))})}
async function decrypt(j){const k=await deriveKey(fromB(j.salt));return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:fromB(j.iv)},k,fromB(j.data))))}
function askPass(){return new Promise(res=>{const d=document.createElement('div');d.className='lock';d.innerHTML=`<div><h3>Unlock</h3><div class="why">${askMsg||'Enter your passphrase'}</div><input type="password" id="lp" autocomplete="current-password"><button class="b p" id="lb">Unlock</button></div>`;document.body.appendChild(d);const go=()=>{const v=$('#lp').value;if(!v)return;d.remove();res(v)};$('#lb').onclick=go;$('#lp').onkeydown=e=>{if(e.key==='Enter')go()};$('#lp').focus()})}
async function parse(text){const j=JSON.parse(text);if(!j.enc)return normalize(j);for(;;){if(!pass)pass=await askPass();try{const d=normalize(await decrypt(j));sessionStorage.setItem('desk_pass',pass);askMsg='';return d}catch(e){pass='';keyC=null;sessionStorage.removeItem('desk_pass');askMsg='Wrong passphrase'}}}
async function readCache(raw){const t=localStorage.getItem('desk_db');if(!t)return raw?null:normalize(null);return parse(t)}
async function cacheDb(){localStorage.setItem('desk_db',await seal(db))}
function setSync(c,t){const e=$('#sync');e.className='sync '+c;e.querySelector('span').textContent=t}
function normalize(d){d=d||{};d.people=d.people||[];const st=d.settings||{};d.settings={...DEFAULTS,...st,templates:st.templates||DEFAULTS.templates.map(t=>({...t}))};return d}
function merge(remote,local){const m=new Map(remote.people.map(p=>[p.id,p]));local.people.forEach(p=>{const r=m.get(p.id);if(!r||(p.updatedAt||0)>(r.updatedAt||0))m.set(p.id,p)});return{people:[...m.values()],settings:local.settings}}
async function pull(){
  if(!cfg.token||!cfg.repo){db=await readCache();setSync('','Local');return}
  setSync('busy','Syncing');
  try{
    const r=await api('GET');
    if(r.status===404){sha=null;db=await readCache();setSync('ok','Synced');if(db.people.length)queueSave();return}
    if(!r.ok)throw new Error(r.status);
    const j=await r.json();sha=j.sha;
    const remote=await parse(b64d(j.content));
    const cached=await readCache(true);
    db=dirty&&cached?merge(remote,cached):remote;
    await cacheDb();setSync('ok','Synced');
  }catch(e){db=await readCache();setSync('err','Offline')}
}
function queueSave(){
  cacheDb();dirty=true;
  if(!cfg.token)return;
  setSync('busy','Saving');clearTimeout(saveT);saveT=setTimeout(push,900);
}
async function push(retry=0){
  try{
    const body={message:'update '+new Date().toISOString(),content:b64e(await seal(db))};
    if(sha)body.sha=sha;
    const r=await api('PUT',body);
    if(r.status===409||r.status===422){
      if(retry>2)throw new Error('conflict');
      const g=await api('GET');const j=await g.json();sha=j.sha;
      db=merge(await parse(b64d(j.content)),db);return push(retry+1);
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
    const gap=p.cadence?p.cadence+Math.ceil(p.cadence/2):S.clientGapDays;if(n>=gap)return{lvl:2,why:`No session in ${n} days`,n}
  }
  return null;
}
const initials=n=>n.trim().split(/\s+/).slice(0,2).map(w=>w[0]).join('').toUpperCase()||'?';
function touch(p){const n=new Date().toISOString();p.updatedAt=Date.now();if(p.type==='inquiry'){p.reached=p.reached||[];if(!p.reached.includes(p.status))p.reached.push(p.status);if(!['new','dropped'].includes(p.status)&&!p.firstReplyAt)p.firstReplyAt=n}else if(!p.convertedAt&&p.origin==='inquiry')p.convertedAt=n}
const sess=p=>p.sessions&&p.sessions.length?p.sessions:(p.lastSession?[p.lastSession]:[]);
function addSession(p,d){const a=sess(p).slice();if(!a.includes(d))a.push(d);a.sort();p.sessions=a;p.lastSession=a[a.length-1];if(!p.lastContact||p.lastContact<d)p.lastContact=d}
const IDX={new:0,replied:1,form_sent:2,form_filled:3,call_booked:4,converted:5};
const stageOf=p=>{if(p.type==='client')return 5;let m=0;[p.status,...(p.reached||[])].forEach(x=>{if(IDX[x]>m)m=IDX[x]});return m};
const WA_SVG='<svg viewBox="0 0 24 24"><path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.16-.17.2-.35.22-.64.07-.3-.15-1.26-.46-2.4-1.48-.89-.8-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.14-.13.3-.35.45-.52.15-.18.2-.3.3-.5.1-.2.05-.38-.02-.53-.08-.15-.67-1.62-.92-2.2-.24-.59-.49-.51-.67-.51h-.57c-.2 0-.52.08-.8.38-.27.3-1.04 1.02-1.04 2.48s1.07 2.87 1.22 3.07c.15.2 2.1 3.2 5.08 4.48.71.3 1.26.49 1.7.63.71.23 1.36.2 1.87.12.57-.08 1.76-.72 2-1.41.25-.7.25-1.29.17-1.41-.07-.13-.27-.2-.57-.35M12.05 21.8a9.87 9.87 0 0 1-5.03-1.38l-.36-.21-3.74.98 1-3.65-.24-.37a9.86 9.86 0 0 1-1.51-5.26c0-5.45 4.44-9.88 9.89-9.88 2.64 0 5.12 1.03 6.99 2.9a9.83 9.83 0 0 1 2.89 6.99c0 5.45-4.44 9.88-9.89 9.88M20.46 3.49A11.82 11.82 0 0 0 12.05 0C5.5 0 .16 5.34.16 11.89c0 2.1.55 4.14 1.59 5.95L.06 24l6.3-1.65a11.88 11.88 0 0 0 5.69 1.45c6.55 0 11.89-5.34 11.89-11.89 0-3.18-1.24-6.17-3.48-8.41"/></svg>';
const waNum=p=>{let n=(p.whatsapp||(/^[+\d][\d\s-]{7,}$/.test(p.contact||'')?p.contact:'')).replace(/\D/g,'');if(!n)return'';if(n.length===11&&n[0]==='0')n=n.slice(1);if(n.length===10)n=db.settings.countryCode+n;return n};
const tplFor=p=>db.settings.templates.filter(t=>t.for==='both'||t.for===p.type);
const msg=(p,t)=>t.text.replace(/\{name\}/g,p.name.trim().split(/\s+/)[0]).replace(/\{form\}/g,db.settings.formLink||'[form link]');
const waLink=(p,t)=>{const n=waNum(p);return n&&t?`https://wa.me/${n}?text=${encodeURIComponent(msg(p,t))}`:''};
function defaultTpl(p){const id=p.type==='client'?'checkin':p.status==='new'?'reply':p.status==='form_sent'?'formremind':'inqfollow';return db.settings.templates.find(t=>t.id===id)||tplFor(p)[0]}
function logWA(id,tid){const p=db.people.find(x=>x.id===id),t=db.settings.templates.find(x=>x.id===tid);if(!p||!t)return;p.lastContact=todayStr();p.waiting='them';if(p.type==='inquiry'&&p.status==='new')p.status='replied';if(tid==='formsend')p.status='form_sent';addLog(p,'WhatsApp: '+t.label);touch(p);queueSave();render()}
function addLog(p,t){p.log=p.log||[];p.log.unshift({d:todayStr(),t});}

/* ---------- insights ---------- */
const hbar=(l,v,max,sub)=>`<div class="hb"><div class="hl"><span>${esc(l)}</span><b>${v}${sub?` <small>${esc(sub)}</small>`:''}</b></div><div class="ht"><i style="width:${max?Math.round(v/max*100):0}%"></i></div></div>`;
function insightsHTML(){
  const P=db.people,inq=P.filter(p=>p.type==='inquiry'||p.origin==='inquiry'),t=todayStr();
  const med=a=>{if(!a.length)return null;a=a.slice().sort((x,y)=>x-y);const m=a.length>>1;return a.length%2?a[m]:(a[m-1]+a[m])/2};
  const fh=h=>h==null?'n/a':h<1?Math.round(h*60)+'m':h<48?Math.round(h)+'h':(h/24).toFixed(1)+'d';
  const rt=med(inq.filter(p=>p.firstReplyAt&&p.created).map(p=>(new Date(p.firstReplyAt)-new Date(p.created))/36e5));
  const st=inq.map(stageOf),conv=st.filter(x=>x===5).length;
  const all=P.flatMap(sess);
  const months=[];for(let i=5;i>=0;i--){const d=toD(t);d.setDate(1);d.setMonth(d.getMonth()-i);months.push(new Date(d-d.getTimezoneOffset()*6e4).toISOString().slice(0,7))}
  const mc=months.map(m=>[toD(m+'-01').toLocaleDateString('en-IN',{month:'short'}),all.filter(x=>x.startsWith(m)).length]);
  const mx=Math.max(1,...mc.map(x=>x[1]));
  const FL=['Inquiries','Replied','Form sent','Form filled','Call booked','Became client'];
  const fc=FL.map((l,i)=>[l,st.filter(x=>x>=i).length]);
  const src=SOURCES.map(s=>[s,inq.filter(p=>p.source===s).length,inq.filter(p=>p.source===s&&stageOf(p)===5).length]).filter(x=>x[1]);
  const act=P.filter(isActiveCl),B=[['0 to 7 days',0,7],['8 to 14',8,14],['15 to 21',15,21],['22 to 30',22,30],['31 or more',31,9999]];
  const bc=B.map(([l,a,b])=>[l,act.filter(p=>{const r=p.lastSession||p.lastContact;if(!r)return false;const n=diff(t,r);return n>=a&&n<=b}).length]);
  const dr={};inq.filter(p=>p.status==='dropped'&&p.dropReason).forEach(p=>dr[p.dropReason]=(dr[p.dropReason]||0)+1);
  const card=(h,b)=>`<h2>${h}</h2><div class="card">${b}</div>`;
  return `<div class="stats"><div class="stat"><b>${fh(rt)}</b><span>Median first reply</span></div><div class="stat"><b>${inq.length?Math.round(conv/inq.length*100):0}%</b><span>Inquiry to client</span></div><div class="stat"><b>${mc[5][1]}</b><span>Sessions this month</span></div></div>`
  +card('Sessions per month',`<div class="vb">${mc.map(([l,v])=>`<div><b>${v}</b><i style="height:${Math.max(v?4:0,Math.round(v/mx*90))}px"></i><span>${l}</span></div>`).join('')}</div>`)
  +card('Inquiry funnel',fc.map(([l,v])=>hbar(l,v,fc[0][1],fc[0][1]?Math.round(v/fc[0][1]*100)+'%':'')).join(''))
  +card('Inquiries by source',src.length?src.map(([s,n,w])=>hbar(s,n,Math.max(...src.map(x=>x[1])),w+' clients')).join(''):'<div class="why">No inquiries yet.</div>')
  +card('Active clients by days since last session',bc.map(([l,v])=>hbar(l,v,Math.max(1,...bc.map(x=>x[1])))).join(''))
  +card('Why inquiries dropped',Object.keys(dr).length?Object.entries(dr).sort((a,b)=>b[1]-a[1]).map(([l,v])=>hbar(l,v,Math.max(...Object.values(dr)))).join(''):'<div class="why">Set a reason on dropped inquiries and it shows here.</div>')
  +`<div class="why" style="margin:14px 4px">Reply time, funnel stages and drop reasons fill in from now on. Sessions use the dates you log.</div>`;
}

/* ---------- render ---------- */
function rowHTML(p,why,cls){
  const st=p.type==='inquiry'?INQ_STATUS[p.status]:CL_STATUS[p.status];
  const t=defaultTpl(p),l=waLink(p,t);
  return `<div class="row" role="button" tabindex="0" data-id="${p.id}"><div class="av ${p.type==='inquiry'?'inq':''}">${esc(initials(p.name))}</div><div class="mid"><div class="nm">${esc(p.name)}</div><div class="why ${cls||''}">${esc(why)}</div></div>${why===st?'':`<span class="pill">${esc(st)}</span>`}${l?`<a class="wa" href="${l}" target="_blank" rel="noopener" data-wa="${p.id}" data-tid="${t.id}" aria-label="WhatsApp: ${esc(t.label)}" title="${esc(t.label)}">${WA_SVG}</a>`:''}</div>`;
}
function render(){
  const t=todayStr(),S=db.settings;
  const att=db.people.map(p=>({p,a:attention(p)})).filter(x=>x.a).sort((a,b)=>b.a.lvl-a.a.lvl||b.a.n-a.a.n);
  $('#title').textContent={today:'Today',inquiry:'Inquiries',client:'Clients',insights:'Insights'}[tab];
  $('#sub').textContent=new Date().toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long'});
  document.querySelectorAll('#seg button').forEach(b=>b.classList.toggle('on',b.dataset.t===tab));
  let h='';
  if(tab==='today'){
    const nNew=db.people.filter(p=>isOpenInq(p)&&p.status==='new').length;
    const nForm=db.people.filter(p=>isOpenInq(p)&&p.status==='form_sent').length;
    const nLapsed=db.people.filter(p=>isActiveCl(p)&&!p.followUp&&attention(p)).length;
    h+=`<div class="stats"><button class="stat ${nNew?'hot':''}" data-go="inquiry"><b>${nNew}</b><span>Awaiting reply</span></button><button class="stat" data-go="inquiry"><b>${nForm}</b><span>Form pending</span></button><button class="stat" data-go="client"><b>${nLapsed}</b><span>Not booked in</span></button></div>`;
    const mine=att.filter(x=>x.p.waiting!=='them'),theirs=att.filter(x=>x.p.waiting==='them');
    const L=a=>`<div class="list">${a.map(x=>rowHTML(x.p,x.a.why,x.a.lvl===2?'red':'or')).join('')}</div>`;
    h+='<h2>Needs follow-up</h2>';
    h+=mine.length?L(mine):'<div class="list"><div class="empty">Nobody needs a nudge right now.</div></div>';
    if(theirs.length)h+='<h2>Waiting on them</h2>'+L(theirs);
    const up=db.people.filter(p=>(isOpenInq(p)||isActiveCl(p))&&p.followUp&&p.followUp>t).sort((a,b)=>a.followUp.localeCompare(b.followUp)).slice(0,6);
    if(up.length)h+=`<h2>Coming up</h2><div class="list">${up.map(p=>rowHTML(p,'Follow up '+fmt(p.followUp))).join('')}</div>`;
  }else if(tab==='insights'){h+=insightsHTML()}else{
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
  $('#main').innerHTML=h;markSel();
  const qi=$('#q');if(qi){qi.oninput=e=>{query=e.target.value;const pos=e.target.selectionStart;render();const n=$('#q');n.focus();n.setSelectionRange(pos,pos)}}
}

/* ---------- sheet ---------- */
function openSheet(html){onDismiss=closeSheet;$('#sheet').dataset.pid='';$('#sheet').innerHTML='<div class="grab"></div>'+html;$('#scrim').classList.add('on');requestAnimationFrame(()=>$('#sheet').classList.add('on'))}
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
    const p={id:uid(),name,whatsapp:$('#w').value.trim(),contact:$('#c').value.trim(),source:$('#s').value,type,status:type==='inquiry'?'new':'active',notes:'',created:new Date().toISOString(),lastContact:t,lastSession:'',followUp:'',log:[],origin:type,waiting:type==='inquiry'?'me':'',sessions:[],updatedAt:Date.now()};touch(p);
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
  <div class="g2"><div><label>Waiting on</label><select id="wt"><option value="">Nobody</option><option value="me">Me</option><option value="them">Them</option></select></div>${inq?`<div><label>If dropped, why</label><select id="dr">${['','No reply from them','Form not filled','Price','Timing','Chose someone else','Not a fit','Other'].map(x=>`<option>${x}</option>`).join('')}</select></div>`:`<div><label>Rhythm</label><select id="rh">${[[0,'Default'],[7,'Weekly'],[14,'Fortnightly'],[30,'Monthly']].map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}</select></div>`}</div>
  ${inq?'':`<label>Sessions (${sess(p).length})</label><div class="g2" style="grid-template-columns:1fr auto"><input type="date" id="ls" value="${t}"><button class="b" id="sa">Add session</button></div><div class="chips" style="margin-top:8px">${sess(p).slice(-8).reverse().map(d=>`<button class="chip" data-sd="${d}">${fmt(d)} ×</button>`).join('')}</div>`}
  <label>Notes</label><textarea id="nt">${esc(p.notes)}</textarea>
  <label>Log</label><div class="g2" style="grid-template-columns:1fr auto"><input id="lg" placeholder="Add an entry" autocomplete="off"><button class="b" id="la">Add</button></div>
  <div class="log">${(p.log||[]).map(l=>`<div>${esc(l.t)}<small>${fmt(l.d)}</small></div>`).join('')}</div>
  <div style="text-align:center;margin-top:18px"><button class="txt dn" id="del">Delete</button></div>`);
  $('#st').value=p.status;$('#wt').value=p.waiting||'';if($('#dr'))$('#dr').value=p.dropReason||'';if($('#rh'))$('#rh').value=p.cadence||0;
  const commit=(msg)=>{touch(p);queueSave();render();if(msg)toast(msg)};
  const save=()=>{p.name=$('#en').value.trim()||p.name;p.contact=$('#ec').value.trim();p.whatsapp=$('#ew').value.trim();p.notes=$('#nt').value;p.status=$('#st').value;p.followUp=$('#fu').value;p.waiting=$('#wt').value;if($('#dr'))p.dropReason=$('#dr').value;if($('#rh'))p.cadence=+$('#rh').value;touch(p);queueSave();render()};
  $('#x').onclick=()=>{save();closeSheet()};
  onDismiss=()=>{save();closeSheet()};
  $('#sheet').dataset.pid=id;
  $('#sheet').querySelectorAll('[data-a]').forEach(b=>b.onclick=()=>{
    const k=b.dataset.a;
    if(k==='contacted'){p.lastContact=t;if(p.status==='new')p.status='replied';p.waiting='them';addLog(p,'Contacted');if(p.followUp&&p.followUp<=t)p.followUp=''}
    if(k==='session'){addSession(p,t);p.lastContact=t;p.followUp='';p.waiting='';addLog(p,'Session held')}
    if(k==='convert'){p.origin='inquiry';p.type='client';p.waiting='';p.status='active';p.followUp='';addLog(p,'Became client');tab='client'}
    save();closeSheet();toast(k==='convert'?'Moved to Clients':'Updated');
  });
  $('#sheet').querySelectorAll('[data-fu]').forEach(b=>b.onclick=()=>{const n=+b.dataset.fu;p.followUp=n?addDays(t,n):'';save();closeSheet();toast(n?'Follow up '+fmt(p.followUp):'Follow-up cleared')});
  $('#sheet').querySelectorAll('.wal').forEach(a=>a.onclick=()=>{save();const tid=a.dataset.tid;a.href=waLink(p,db.settings.templates.find(t=>t.id===tid))||a.href;setTimeout(()=>{logWA(id,tid);personSheet(id)},50)});
  if($('#sa'))$('#sa').onclick=()=>{save();addSession(p,$('#ls').value||t);commit('Session added');personSheet(id)};
  $('#sheet').querySelectorAll('[data-sd]').forEach(b=>b.onclick=()=>{const d=b.dataset.sd;if(confirm('Remove session on '+fmt(d)+'?')){save();p.sessions=sess(p).filter(x=>x!==d);p.lastSession=p.sessions[p.sessions.length-1]||'';commit();personSheet(id)}});
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
  <label>Encryption passphrase. Leave empty for none. It cannot be recovered if forgotten.</label><input id="pp" type="password" autocomplete="new-password" value="${esc(pass)}">
  <div class="btns"><button class="b" id="ex">Export backup</button><button class="b" id="im">Import backup</button><button class="b" id="kb">Shortcuts</button></div>
  <div class="why" style="margin-top:12px">Token stays in this browser only. Data is saved as one JSON file in your private repo. Export backup is not encrypted.</div>`);
  $('#x').onclick=closeSheet;
  $('#ok').onclick=async()=>{
    const np=$('#pp').value,changed=np!==pass;
    cfg={repo:$('#rp').value.trim(),path:$('#pa').value.trim()||'data.json',token:$('#tk').value.trim()};
    localStorage.setItem('desk_cfg',JSON.stringify(cfg));
    db.settings.clientGapDays=+$('#cg').value||21;db.settings.inquiryGapDays=+$('#ig').value||2;db.settings.countryCode=$('#cc').value.replace(/\D/g,'')||'91';db.settings.formLink=$('#fl').value.trim();document.querySelectorAll('[data-ti]').forEach(x=>{db.settings.templates[+x.dataset.ti].text=x.value});
    if(changed){pass=np;keyC=null;np?sessionStorage.setItem('desk_pass',np):sessionStorage.removeItem('desk_pass');closeSheet();queueSave();render();toast(np?'Encryption on':'Encryption off');return}
    closeSheet();await pull();queueSave();render();
  };
  $('#kb').onclick=helpSheet;
  $('#ex').onclick=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(db,null,1)],{type:'application/json'}));a.download='desk-backup-'+todayStr()+'.json';a.click()};
  $('#im').onclick=()=>{const f=document.createElement('input');f.type='file';f.accept='.json';f.onchange=async()=>{try{db=await parse(await f.files[0].text());queueSave();closeSheet();render();toast('Imported')}catch(e){toast('Invalid file')}};f.click()};
}

/* ---------- keyboard ---------- */
const typing=e=>/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)||e.target.isContentEditable;
const sheetOn=()=>$('#sheet').classList.contains('on');
function markSel(){document.querySelectorAll('.row.sel').forEach(r=>r.classList.remove('sel'));const r=selId&&document.querySelector(`#main .row[data-id="${selId}"]`);if(r)r.classList.add('sel')}
function moveSel(d){const rows=[...document.querySelectorAll('#main .row')];if(!rows.length)return;let i=rows.findIndex(r=>r.dataset.id===selId);i=i<0?(d>0?0:rows.length-1):Math.min(rows.length-1,Math.max(0,i+d));selId=rows[i].dataset.id;markSel();rows[i].scrollIntoView({block:'nearest'})}
function go(t){if(tab!==t){tab=t;selId=null;render()}}
function helpSheet(){
  const R=[['N','New person'],['T  I  C  M','Today, Inquiries, Clients, Insights (or 1 to 4)'],['/','Search'],['J  K','Move down and up (or arrow keys)'],['Enter','Open selected person'],['W','WhatsApp selected person'],[',','Settings'],['?','This list'],['Esc','Close, saves edits'],['Ctrl or Cmd Enter','Save and close'],['D','In a person: contacted today'],['S','In a person: session done'],['W','In a person: WhatsApp']];
  openSheet(`<div class="sh-h"><span style="width:44px"></span><h3>Shortcuts</h3><button class="txt" id="x">Done</button></div><div class="list" style="margin-top:12px">${R.map(([k,t])=>`<div class="kr"><kbd>${k}</kbd><span>${t}</span></div>`).join('')}</div>`);
  $('#x').onclick=closeSheet;
}
document.addEventListener('keydown',e=>{
  const s=$('#sheet');
  if(e.key==='Escape'){if(sheetOn()){e.preventDefault();onDismiss()}else if(document.activeElement&&document.activeElement.id==='q')document.activeElement.blur();return}
  if((e.ctrlKey||e.metaKey)&&e.key==='Enter'&&sheetOn()){const b=s.querySelector('#save')||s.querySelector('#ok')||s.querySelector('#x');if(b){e.preventDefault();b.click()}return}
  if(e.key==='Enter'&&sheetOn()&&['n','c','w'].includes(e.target.id)&&s.querySelector('#save')){e.preventDefault();s.querySelector('#save').click();return}
  if(e.ctrlKey||e.metaKey||e.altKey||typing(e))return;
  const k=e.key.toLowerCase();
  if(sheetOn()){
    if(k==='d'){const b=s.querySelector('[data-a=contacted]');if(b){e.preventDefault();b.click()}}
    else if(k==='s'){const b=s.querySelector('[data-a=session]');if(b){e.preventDefault();b.click()}}
    else if(k==='w'){const p=db.people.find(x=>x.id===s.dataset.pid);if(p){const t=defaultTpl(p),a=s.querySelector(`.wal[data-tid="${t.id}"]`)||s.querySelector('.wal');if(a){e.preventDefault();a.click()}}}
    return;
  }
  if(k==='n'){e.preventDefault();addSheet()}
  else if(k==='t'||k==='1')go('today');
  else if(k==='i'||k==='2')go('inquiry');
  else if(k==='c'||k==='3')go('client');
  else if(k==='m'||k==='4')go('insights');
  else if(k==='/'){e.preventDefault();if(tab==='today'||tab==='insights')go('inquiry');const q=$('#q');if(q){q.focus();q.select()}}
  else if(k==='j'||k==='arrowdown'){e.preventDefault();moveSel(1)}
  else if(k==='k'||k==='arrowup'){e.preventDefault();moveSel(-1)}
  else if(k==='enter'){if(selId&&e.target===document.body)personSheet(selId)}
  else if(k==='w'){const a=document.querySelector('#main .row.sel .wa');if(a){e.preventDefault();a.click()}}
  else if(k===','){e.preventDefault();settingsSheet()}
  else if(k==='?'){e.preventDefault();helpSheet()}
});

/* ---------- events ---------- */
$('#seg').onclick=e=>{const b=e.target.closest('button');if(b){tab=b.dataset.t;render()}};
$('#main').onclick=e=>{const w=e.target.closest('.wa');if(w){const id=w.dataset.wa,tid=w.dataset.tid;setTimeout(()=>logWA(id,tid),50);return}const r=e.target.closest('.row'),s=e.target.closest('[data-go]');if(r)personSheet(r.dataset.id);else if(s){tab=s.dataset.go;render()}};
$('#main').onkeydown=e=>{if(e.key==='Enter'&&e.target.classList.contains('row'))personSheet(e.target.dataset.id)};
$('#fab').onclick=addSheet;
$('#scrim').onclick=()=>onDismiss();
$('#sync').onclick=settingsSheet;
document.addEventListener('visibilitychange',async()=>{if(!document.hidden&&cfg.token&&!dirty){await pull();render()}});
addEventListener('beforeunload',e=>{if(dirty&&cfg.token){e.preventDefault();e.returnValue=''}});

(async()=>{await pull();render();if(!cfg.token&&!db.people.length)setTimeout(()=>toast('Tap Local to connect your private repo'),600)})();
