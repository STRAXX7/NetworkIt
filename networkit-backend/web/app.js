// ═══════════════════════════════════════════════════════════════
// NetworkIt — Phase 1 frontend logic, backed by Supabase.
//
// This replaces the original prototype's `const DB = { g, s, d }`
// localStorage shim. Every function name referenced by an
// onclick="" / oninput="" / f: handler in the HTML markup is
// preserved so the markup itself did not need to change — only
// where the data comes from changed.
//
// Deferred to Phase 2 (see README.md): admin panel, notifications
// (incl. "smart" digest/reminder checks), real presence/online
// status, profile-view tracking, profile-completeness + "people
// like you" widgets (these were already dead code in the original
// — defined but never called — so nothing is lost by not porting
// them).
// ═══════════════════════════════════════════════════════════════

const _cfg = window.NETWORKIT_CONFIG || {};
if (!_cfg.SUPABASE_URL || _cfg.SUPABASE_URL.includes("YOUR-PROJECT-REF")) {
  console.error("NetworkIt: config.js is missing or still has placeholder values. Copy config.example.js to config.js and fill in your Supabase project's URL + anon key.");
}
const sb = window.supabase.createClient(_cfg.SUPABASE_URL, _cfg.SUPABASE_ANON_KEY);

// ─────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────
let SESSION = null;        // Supabase auth session
let ME = null;              // mapped own-profile object (see mapOwnProfile)
let MY_PRIVACY = null;      // {loc,uni,soc,srch,jd}
let SAVED_IDS = new Set();  // ids the current user has bookmarked
let CUR = "landing";
let CurSec = "discover";

// ─────────────────────────────────────────────
// ROW → VIEW-MODEL MAPPERS
// (keeps the render/template code below nearly identical to the
// original prototype, which used these short keys throughout)
// ─────────────────────────────────────────────
function mapCard(row) {
  return {
    id: row.id, un: row.username, fn: row.first_name, ln: row.last_name,
    fi: row.field, st: row.status, ci: row.city, co: row.country,
    bio: row.bio, int: row.interests || [], av: row.avatar_url, ban: row.is_banned,
  };
}
function mapProfilePage(row) {
  return {
    id: row.id, un: row.username, fn: row.first_name, ln: row.last_name,
    fi: row.field, st: row.status, yr: row.year_level, sc: row.school, bio: row.bio,
    int: row.interests || [], la: row.languages || [], gl: row.goals || [], av: row.avatar_url,
    ci: row.city, rg: row.region, co: row.country, uni: row.university,
    tg: row.telegram, ig: row.instagram, wa: row.whatsapp, li: row.linkedin, emp: row.public_email,
    jd: row.join_date ? new Date(row.join_date).toLocaleDateString("en-US", { month: "short", year: "numeric" }) : "",
    ban: row.is_banned,
  };
}
function mapOwnProfile(row) {
  return {
    id: row.id, un: row.username, fn: row.first_name, ln: row.last_name,
    dob: row.date_of_birth, gen: row.gender, co: row.country, rg: row.region, ci: row.city,
    st: row.status, sc: row.school, uni: row.university, fi: row.field, yr: row.year_level,
    bio: row.bio, int: row.interests || [], la: row.languages || [], gl: row.goals || [],
    ph: row.phone, tg: row.telegram, ig: row.instagram, wa: row.whatsapp, li: row.linkedin, emp: row.public_email,
    av: row.avatar_url, adm: row.is_admin, ban: row.is_banned,
    jd: row.created_at ? new Date(row.created_at).toLocaleDateString("en-US", { month: "short", year: "numeric" }) : "",
  };
}

const AVC = ['linear-gradient(135deg,#5B5FEF,#8B8FFF)','linear-gradient(135deg,#7C3AED,#A78BFA)','linear-gradient(135deg,#0891B2,#67E8F9)','linear-gradient(135deg,#D97706,#FCD34D)','linear-gradient(135deg,#059669,#6EE7B7)','linear-gradient(135deg,#BE185D,#F9A8D4)','linear-gradient(135deg,#DC2626,#FCA5A5)','linear-gradient(135deg,#0284C7,#7DD3FC)'];
const ac = id => { const i = id ? [...id].reduce((a,c)=>a+c.charCodeAt(0),0) % AVC.length : 0; return AVC[i]; };
const ah = u => u.av ? `<img src="${u.av}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">` : ((u.fn||'?')[0]+(u.ln?u.ln[0]:'')).toUpperCase();
function me(){ return ME; }
function escapeHTML(s){ return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>'); }
function fmtMsgTime(ts){ const d=new Date(ts), now=new Date(), diff=(now-d)/1000; if(diff<60) return 'now'; if(diff<3600) return Math.floor(diff/60)+'m'; if(diff<86400) return Math.floor(diff/3600)+'h'; return Math.floor(diff/86400)+'d'; }
function setMsg(id,msg,type){ const el=document.getElementById(id); if(!el) return; el.textContent=msg; el.className='amsg'+(type?' '+type:''); el.style.display=msg?'block':'none'; }

// ═══════ SESSION / PROFILE LOADING ═══════
async function refreshSession(){
  const { data } = await sb.auth.getSession();
  SESSION = data.session;
  return SESSION;
}
async function loadMyProfile(){
  if(!SESSION){ ME=null; MY_PRIVACY=null; return null; }
  const { data: prow, error } = await sb.from('profiles').select('*').eq('id', SESSION.user.id).single();
  if(error || !prow){ ME=null; return null; }
  ME = mapOwnProfile(prow);
  ME.em = SESSION.user.email;
  const { data: prv } = await sb.from('privacy_settings').select('*').eq('profile_id', SESSION.user.id).single();
  MY_PRIVACY = prv ? { loc:prv.show_location, uni:prv.show_university, soc:prv.show_socials, srch:prv.show_in_search, jd:prv.show_join_date } : { loc:true,uni:true,soc:true,srch:true,jd:true };
  return ME;
}
async function loadSavedIds(){
  if(!SESSION){ SAVED_IDS = new Set(); return; }
  const { data } = await sb.from('saved_profiles').select('saved_profile_id').eq('user_id', SESSION.user.id);
  SAVED_IDS = new Set((data||[]).map(r=>r.saved_profile_id));
}
function isSaved(id){ return SAVED_IDS.has(id); }

// ═══════ ROUTING ═══════
function showPage(p){
  document.querySelectorAll('.page').forEach(e=>e.classList.remove('active'));
  const pg=document.getElementById('page-'+p); if(pg) pg.classList.add('active');
  CUR=p;
  const nav=document.getElementById('nav'); if(nav) nav.style.display = p==='app' ? 'none':'flex';
  if(p==='app') bootApp();
  window.scrollTo(0,0);
}
function goHome(){ SESSION ? showPage('app') : showPage('landing'); }
function toggleMM(){ document.getElementById('mobile-menu')?.classList.toggle('open'); }
function scrollTo_(id){
  if(CUR!=='landing'){ showPage('landing'); setTimeout(()=>document.getElementById(id)?.scrollIntoView({behavior:'smooth'}),300); }
  else document.getElementById(id)?.scrollIntoView({behavior:'smooth'});
}
function previewUser(usernameOrId){ SESSION ? viewProfile(usernameOrId) : showPage('login'); }

// ═══════ LANDING ═══════
const FAQS=[
  {q:'Who is NetworkIt for?',a:'Anyone who wants to build something — high school students, gap year students, university students, graduates, self-taught builders, and professionals. If you have goals and ambition, you belong here.'},
  {q:'Do I need to be in university to join?',a:'No. NetworkIt is open to everyone — high schoolers looking for project partners, gap year students building their CV, self-taught coders, and working professionals alike.'},
  {q:'Is NetworkIt free to use?',a:'Yes — creating a profile, discovering people, and messaging is completely free.'},
  {q:'What can I use NetworkIt for?',a:'Finding a co-founder for your startup idea, building projects for your CV or college application, finding study partners, getting mentorship, research collaboration, or simply networking in your field.'},
  {q:'Is my personal information safe?',a:'Yes. Your phone number is never shown publicly. You control exactly what appears on your profile — location, university, and social links can all be hidden in Privacy Settings.'},
  {q:'Can I control what others see on my profile?',a:'Yes. In Settings → Privacy you choose which fields are visible: location, university, social links, join date, and whether you appear in search results at all.'},
  {q:'How does NetworkIt prevent fake accounts?',a:'Registration requires a verified email address. Users can report suspicious profiles for our team to review.'},
  {q:'Can I delete my account?',a:'Yes. Go to Settings → Danger zone → Delete account. This permanently removes your profile and all your data.'},
];
function renderLanding(){
  const fl=document.getElementById('faq-list');
  if(fl) fl.innerHTML = FAQS.map(f=>`
    <div class="faq-item">
      <button class="faq-q" onclick="this.closest('.faq-item').classList.toggle('open')">${f.q}<span class="faq-icon">+</span></button>
      <div class="faq-a"><p>${f.a}</p></div>
    </div>`).join('');
}
async function updateHeroStats(){
  const { data } = await sb.rpc('get_landing_stats');
  const row=(data&&data[0])||{members:0,fields:0,countries:0};
  const fmt=n=>n===0?'Be first!':n<10?String(n):n<100?n+'+':(Math.floor(n/100)*100)+'+';
  const se=document.getElementById('stat-members'); if(se) se.textContent=fmt(Number(row.members));
  const sf=document.getElementById('stat-fields'); if(sf) sf.textContent=fmt(Number(row.fields));
  const sc=document.getElementById('stat-countries'); if(sc) sc.textContent=fmt(Number(row.countries));
}

// ═══════ AUTH ═══════
async function loginWithGoogle(){
  const { error } = await sb.auth.signInWithOAuth({ provider:'google', options:{ redirectTo: window.location.origin + window.location.pathname } });
  if(error) toast('Google sign-in is not configured for this project yet.','err');
}
async function doLogin(){
  const em=(document.getElementById('li-em')?.value||'').trim();
  const pw=document.getElementById('li-pw')?.value||'';
  const err=document.getElementById('li-msg');
  if(err) err.style.display='none';
  const showErr=m=>{ if(err){ err.textContent=m; err.className='amsg err'; err.style.display='block'; } };
  if(!em||!pw) return showErr('Please fill in all fields');
  const { data, error } = await sb.auth.signInWithPassword({ email: em, password: pw });
  if(error) return showErr('Incorrect email or password');
  SESSION = data.session;
  await loadMyProfile();
  if(!ME){ await sb.auth.signOut(); SESSION=null; return showErr('Could not load your profile. Please try again.'); }
  if(ME.ban){
    await sb.auth.signOut(); SESSION=null; ME=null;
    return showErr('Your account has been banned. Contact support.');
  }
  const pwInp=document.getElementById('li-pw'); if(pwInp) pwInp.value='';
  await loadSavedIds();
  showPage('app'); toast('Welcome back, '+ME.fn+'! 👋','ok');
}
async function doLogout(){
  await sb.auth.signOut();
  SESSION=null; ME=null; MY_PRIVACY=null; SAVED_IDS=new Set();
  showPage('landing'); toast('Logged out');
}
function forgotModal(){
  openModal('Reset password','Enter your email and we\'ll send a reset link.',
    '<div class="fg"><label class="fl">Email</label><input class="fi" id="frgt-em" placeholder="you@email.com" type="email"></div>',
    [{l:'Cancel',c:'btn btn-ghost btn-sm',f:'closeModal()'},{l:'Send link',c:'btn btn-primary btn-sm',f:'sendReset()'}]);
}
async function sendReset(){
  const e=(document.getElementById('frgt-em')?.value||'').trim();
  if(!e) return toast('Enter your email','err');
  const { error } = await sb.auth.resetPasswordForEmail(e, { redirectTo: window.location.origin + window.location.pathname });
  closeModal();
  // Intentionally the same message either way — telling a visitor whether an
  // email is registered is an account-enumeration leak the original prototype had.
  toast(error ? 'Something went wrong. Please try again.' : "If that email has an account, we've sent a reset link.", error?'err':'ok');
}

// ═══════ REGISTRATION ═══════
const SNMS=['Basic info','Location','Education','Interests','Languages','About','Goals','Contact'];
const INTS=['Business','Economics','Finance','Law','Medicine','Computer Science','Engineering','Psychology','Marketing','Design','Entrepreneurship','Artificial Intelligence','Mathematics','Physics','Biology','Chemistry','History','Philosophy','Sociology','Political Science','Architecture','Music','Literature','Neuroscience','Biotechnology'];
const LAS=['English','Spanish','French','German','Arabic','Russian','Chinese','Japanese','Portuguese','Italian','Korean','Turkish','Hindi','Dutch','Polish','Swedish','Norwegian','Danish','Ukrainian','Uzbek','Persian','Thai','Vietnamese','Indonesian','Yoruba','Swahili','Bengali'];
const GLS=[{i:'👫',l:'Looking for friends'},{i:'📚',l:'Study partners'},{i:'🤝',l:'Networking'},{i:'🚀',l:'Startup co-founders'},{i:'🎓',l:'Mentorship'},{i:'🔬',l:'Research collaboration'},{i:'💼',l:'Internship opportunities'},{i:'📈',l:'Career networking'}];
const CTRS=['Afghanistan','Albania','Algeria','Argentina','Armenia','Australia','Austria','Azerbaijan','Bangladesh','Belarus','Belgium','Brazil','Canada','Chile','China','Colombia','Croatia','Czech Republic','Denmark','Egypt','Finland','France','Georgia','Germany','Ghana','Greece','Hungary','India','Indonesia','Iran','Ireland','Palestine','Italy','Japan','Kazakhstan','Kenya','South Korea','Malaysia','Mexico','Morocco','Netherlands','New Zealand','Nigeria','Norway','Pakistan','Peru','Philippines','Poland','Portugal','Romania','Russia','Saudi Arabia','Serbia','Singapore','Spain','Sweden','Switzerland','Turkey','Ukraine','United Arab Emirates','United Kingdom','United States','Uzbekistan','Vietnam'];
let RS=1, RD={};
function initReg(){ RS=1; RD={}; renderReg(); }
function renderReg(){
  const tot=8;
  const lbl=document.getElementById('step-label'); const nm=document.getElementById('step-name');
  const pf=document.getElementById('progress-fill'); const dots=document.getElementById('reg-dots');
  const c=document.getElementById('reg-card');
  if(lbl) lbl.textContent='Step '+RS+' of '+tot;
  if(nm) nm.textContent=SNMS[RS-1];
  if(pf) pf.style.width=((RS/tot)*100)+'%';
  if(dots) dots.innerHTML=Array.from({length:tot},(_,i)=>'<div class="rdot '+(i<RS-1?'dn':i===RS-1?'act':'')+'"></div>').join('');
  if(!c) return;
  c.innerHTML=buildReg(RS);
  c.classList.remove('fin'); void c.offsetWidth; c.classList.add('fin');
}
function buildReg(s){
  const back=s>1?`<button class="btn btn-ghost btn-sm" onclick="rBack()">← Back</button>`:`<button class="btn btn-ghost btn-sm" onclick="showPage('landing')">← Home</button>`;
  const next=s<8?`<button class="btn btn-primary" onclick="rNext()">Continue →</button>`:`<button class="btn btn-primary" onclick="rFinish()">Create account 🎉</button>`;
  const nav=`<div class="rnav">${back}${next}</div>`;
  if(s===1)return`<h2 style="font-size:22px;font-weight:700;margin-bottom:7px">Basic information</h2><p style="font-size:14px;color:var(--text3);margin-bottom:24px">Tell us a little about yourself.</p>
    <div id="rerr" class="amsg err"></div>
    <div class="frow"><div class="fg"><label class="fl">First name *</label><input class="fi" id="r-fn" type="text" placeholder="Jane" value="${RD.fn||''}"></div><div class="fg"><label class="fl">Last name *</label><input class="fi" id="r-ln" type="text" placeholder="Doe" value="${RD.ln||''}"></div></div>
    <div class="fg"><label class="fl">Username *</label><input class="fi" id="r-un" type="text" placeholder="janedoe99" value="${RD.un||''}"></div>
    <div class="fg"><label class="fl">Email *</label><input class="fi" id="r-em" type="email" placeholder="you@example.com" value="${RD.em||''}"></div>
    <div class="fg"><label class="fl">Password *</label><input class="fi" id="r-pw" type="password" placeholder="At least 8 characters" oninput="pwdStr(this)"><div class="pb" id="pbar"></div><div class="plb" id="plbl"></div></div>
    <div class="fg"><label class="fl">Date of birth *</label><div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px"><input class="fi" id="r-dob-d" type="number" placeholder="Day" min="1" max="31" style="text-align:center"><input class="fi" id="r-dob-m" type="number" placeholder="Month" min="1" max="12" style="text-align:center"><input class="fi" id="r-dob-y" type="number" placeholder="Year" min="1950" max="2015" style="text-align:center"></div><div class="fhint">Day &middot; Month &middot; Year</div></div>
    <div class="fg"><label class="fl">Gender <span style="color:var(--text3)">(optional)</span></label><div class="rg" id="r-gen">${['Male','Female','Non-binary','Prefer not to say'].map(g=>`<div class="rb${RD.gen===g?' sel':''}" onclick="selR(this,'r-gen')">${g}</div>`).join('')}</div></div>
    ${nav}`;
  if(s===2)return`<h2 style="font-size:22px;font-weight:700;margin-bottom:7px">Where are you based?</h2><p style="font-size:14px;color:var(--text3);margin-bottom:24px">Help others find people near them.</p>
    <div id="rerr" class="amsg err"></div>
    <div class="fg"><label class="fl">Country *</label><select class="fi" id="r-co"><option value="">Select country</option>${CTRS.map(c=>`<option${RD.co===c?' selected':''}>${c}</option>`).join('')}</select></div>
    <div class="fg"><label class="fl">Region / State</label><input class="fi" id="r-rg" type="text" placeholder="e.g. Bavaria" value="${RD.rg||''}"></div>
    <div class="fg"><label class="fl">City *</label><input class="fi" id="r-ci" type="text" placeholder="e.g. Munich" value="${RD.ci||''}"></div>
    ${nav}`;
  if(s===3)return`<h2 style="font-size:22px;font-weight:700;margin-bottom:7px">Education & career</h2><p style="font-size:14px;color:var(--text3);margin-bottom:24px">Help others find people at the same stage.</p>
    <div id="rerr" class="amsg err"></div>
    <div class="fg"><label class="fl">Status *</label><div class="rg" id="r-st">${['Student','Professional'].map(g=>`<div class="rb${RD.st===g?' sel':''}" onclick="selR(this,'r-st')">${g}</div>`).join('')}</div></div>
    <div class="fg"><label class="fl">School <span style="color:var(--text3)">(optional)</span></label><input class="fi" id="r-sc" type="text" value="${RD.sc||''}"></div>
    <div class="fg"><label class="fl">University <span style="color:var(--text3)">(optional)</span></label><input class="fi" id="r-uni" type="text" placeholder="e.g. MIT, Oxford" value="${RD.uni||''}"></div>
    <div class="fg"><label class="fl">Field / Major *</label><input class="fi" id="r-fi" type="text" placeholder="e.g. Computer Science" value="${RD.fi||''}"></div>
    <div class="fg"><label class="fl">Year / Level</label><input class="fi" id="r-yr" type="text" placeholder="e.g. 2nd Year, Masters" value="${RD.yr||''}"></div>
    ${nav}`;
  if(s===4)return`<h2 style="font-size:22px;font-weight:700;margin-bottom:7px">Your interests</h2><p style="font-size:14px;color:var(--text3);margin-bottom:24px">Pick as many as you like.</p>
    <div class="chipg" id="r-int">${INTS.map(i=>`<div class="chip${(RD.int||[]).includes(i)?' sel':''}" onclick="this.classList.toggle('sel')">${i}</div>`).join('')}</div>${nav}`;
  if(s===5)return`<h2 style="font-size:22px;font-weight:700;margin-bottom:7px">Languages you speak</h2><p style="font-size:14px;color:var(--text3);margin-bottom:24px">Help find people you can talk to.</p>
    <div class="chipg" id="r-la">${LAS.map(l=>`<div class="chip${(RD.la||[]).includes(l)?' sel':''}" onclick="this.classList.toggle('sel')">${l}</div>`).join('')}</div>${nav}`;
  if(s===6)return`<h2 style="font-size:22px;font-weight:700;margin-bottom:7px">About you</h2><p style="font-size:14px;color:var(--text3);margin-bottom:24px">Write a short bio. The first thing people see.</p>
    <div class="fg"><label class="fl">Bio (max 300 characters)</label><textarea class="fi" id="r-bio" maxlength="300" rows="5" placeholder="Tell others who you are, what you study, and what you're passionate about…" oninput="document.getElementById('bcnt').textContent=this.value.length+'/300'">${RD.bio||''}</textarea><div class="ccnt" id="bcnt">${(RD.bio||'').length}/300</div></div>${nav}`;
  if(s===7)return`<h2 style="font-size:22px;font-weight:700;margin-bottom:7px">What are your goals?</h2><p style="font-size:14px;color:var(--text3);margin-bottom:24px">Select everything that applies.</p>
    <div style="display:flex;flex-direction:column;gap:9px" id="r-gl">${GLS.map(g=>`<div class="gchip${(RD.gl||[]).includes(g.l)?' sel':''}" onclick="this.classList.toggle('sel')"><span style="font-size:17px">${g.i}</span>${g.l}</div>`).join('')}</div>${nav}`;
  if(s===8)return`<h2 style="font-size:22px;font-weight:700;margin-bottom:7px">Contact details</h2>
    <p style="font-size:14px;color:var(--text3);margin-bottom:24px">Your phone number is private and only for verification. Optional links appear as buttons on your profile.</p>
    <div id="rerr" class="amsg err"></div>
    <div class="fg"><label class="fl">Phone number *</label><input class="fi" id="r-ph" type="tel" placeholder="+1 555 000 0000" value="${RD.ph||''}"><div class="fhint">🔒 Never shown publicly</div></div>
    <div style="height:1px;background:var(--border);margin:18px 0"></div>
    <div class="frow"><div class="fg"><label class="fl">Telegram</label><input class="fi" id="r-tg" placeholder="@username" value="${RD.tg||''}"></div><div class="fg"><label class="fl">Instagram</label><input class="fi" id="r-ig" placeholder="@username" value="${RD.ig||''}"></div></div>
    <div class="frow"><div class="fg"><label class="fl">WhatsApp</label><input class="fi" id="r-wa" placeholder="+1 555 000 0000" value="${RD.wa||''}"></div><div class="fg"><label class="fl">LinkedIn</label><input class="fi" id="r-li" placeholder="linkedin.com/in/…" value="${RD.li||''}"></div></div>
    <div class="fg"><label class="fl">Public email</label><input class="fi" id="r-ep" type="email" placeholder="contact@you.com" value="${RD.emp||''}"></div>
    ${nav}`;
}
function selR(el,gid){ el.closest('#'+gid).querySelectorAll('.rb').forEach(b=>b.classList.remove('sel')); el.classList.add('sel'); }
async function collectR(s){
  const err=document.getElementById('rerr'); if(err) err.style.display='none';
  const v=id=>(document.getElementById(id)?.value||'').trim();
  const selR2=gid=>{ const el=document.querySelector('#'+gid+' .sel'); return el?el.textContent.trim():''; };
  const chips=cid=>[...document.querySelectorAll('#'+cid+' .sel')].map(e=>e.textContent.trim());
  const E=(msg)=>{ if(err){ err.textContent=msg; err.style.display='block'; } return false; };
  if(s===1){
    RD.fn=v('r-fn'); RD.ln=v('r-ln'); RD.un=v('r-un'); RD.em=v('r-em'); RD.pw=v('r-pw'); RD.gen=selR2('r-gen');
    const _dd=v('r-dob-d'), _dm=v('r-dob-m'), _dy=v('r-dob-y');
    RD.dob=(_dy&&_dm&&_dd)?_dy+'-'+String(_dm).padStart(2,'0')+'-'+String(_dd).padStart(2,'0'):'';
    if(!RD.fn||!RD.ln||!RD.un||!RD.em||!RD.pw) return E('Please fill in all required fields');
    if(!RD.dob) return E('Please enter your date of birth (Day / Month / Year)');
    if(RD.pw.length<8) return E('Password must be at least 8 characters');
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(RD.em)) return E('Please enter a valid email');
    const { data: available, error } = await sb.rpc('is_username_available', { p_username: RD.un });
    if(!error && available===false) return E('This username is already taken');
  }
  if(s===2){ RD.co=v('r-co'); RD.rg=v('r-rg'); RD.ci=v('r-ci'); if(!RD.co||!RD.ci) return E('Country and city are required'); }
  if(s===3){ RD.st=selR2('r-st'); RD.sc=v('r-sc'); RD.uni=v('r-uni'); RD.fi=v('r-fi'); RD.yr=v('r-yr'); if(!RD.fi) return E('Please enter your field or major'); }
  if(s===4) RD.int=chips('r-int');
  if(s===5) RD.la=chips('r-la');
  if(s===6) RD.bio=document.getElementById('r-bio')?.value||'';
  if(s===7) RD.gl=[...document.querySelectorAll('#r-gl .sel')].map(e=>{ const span=e.querySelector('span'); return e.textContent.trim().replace(span?span.textContent:'','').trim(); });
  if(s===8){ RD.ph=v('r-ph'); RD.tg=v('r-tg'); RD.ig=v('r-ig'); RD.wa=v('r-wa'); RD.li=v('r-li'); RD.emp=v('r-ep'); if(!RD.ph) return E('Phone number is required'); }
  return true;
}
async function rNext(){ if(await collectR(RS)){ RS++; renderReg(); } }
async function rBack(){ await collectR(RS); RS--; renderReg(); }
async function rFinish(){
  if(!(await collectR(RS))) return;
  const err=document.getElementById('rerr');
  const showErr=m=>{ if(err){ err.textContent=m; err.style.display='block'; } };
  const { data, error } = await sb.auth.signUp({ email: RD.em, password: RD.pw });
  if(error){
    RS=1; renderReg();
    return showErr(/registered/i.test(error.message) ? 'An account with this email already exists' : error.message);
  }
  if(!data.session){
    toast('Almost done — check your email to confirm your account, then log in.','ok');
    showPage('login');
    return;
  }
  SESSION = data.session;
  const payload = {
    id: data.user.id, username: RD.un, first_name: RD.fn, last_name: RD.ln,
    date_of_birth: RD.dob||null, gender: RD.gen||null,
    country: RD.co, region: RD.rg||null, city: RD.ci,
    status: RD.st||null, school: RD.sc||null, university: RD.uni||null,
    field: RD.fi, year_level: RD.yr||null, bio: RD.bio||null,
    interests: RD.int||[], languages: RD.la||[], goals: RD.gl||[],
    phone: RD.ph, telegram: RD.tg||null, instagram: RD.ig||null, whatsapp: RD.wa||null,
    linkedin: RD.li||null, public_email: RD.emp||null,
  };
  const { error: perr } = await sb.from('profiles').insert(payload);
  if(perr){
    showErr(perr.code==='23505' ? 'That username was just taken — go back and pick another.' : 'Could not create your profile: '+perr.message);
    return;
  }
  await loadMyProfile();
  await loadSavedIds();
  toast('Welcome to NetworkIt, '+ME.fn+'! 🎉','ok');
  showPage('app');
}

// ═══════ APP BOOT ═══════
async function bootApp(){
  if(!SESSION){ showPage('login'); return; }
  if(!ME) await loadMyProfile();
  if(!ME){ showPage('login'); return; }
  const sbnm=document.getElementById('sb-nm'); if(sbnm) sbnm.textContent=ME.fn+' '+ME.ln;
  const sbrl=document.getElementById('sb-rl'); if(sbrl) sbrl.textContent=ME.st||'Member';
  updSBav();
  // Admin panel + Notifications are Phase 2 — no real backend behind them
  // yet, so they stay hidden rather than ship broken/insecure UI.
  const sadm=document.getElementById('sn-admin'); if(sadm) sadm.style.display='none';
  const snotif=document.getElementById('sn-notifications'); if(snotif) snotif.style.display='none';
  popFilters();
  await loadSavedIds();
  showSec('discover');
  renderMyProfile();
  popEP();
  popStSettings();
  loadPrivToggles();
}
function updSBav(){
  const m=me(); if(!m) return;
  const el=document.getElementById('sb-av'); if(!el) return;
  el.style.background=ac(m.id);
  el.innerHTML = m.av ? `<img src="${m.av}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">` : (m.fn[0]+(m.ln?m.ln[0]:'')).toUpperCase();
}
function showSec(s){
  document.querySelectorAll('.sec').forEach(e=>{ e.classList.remove('sh'); e.style.display='none'; });
  const t=document.getElementById('sec-'+s); if(t){ t.classList.add('sh'); t.style.display='block'; }
  document.querySelectorAll('.sbl').forEach(b=>b.classList.remove('ac'));
  const nb=document.getElementById('sn-'+s); if(nb) nb.classList.add('ac');
  CurSec=s;
  closeSB();
  if(s==='discover') runSearch();
  if(s==='messages'){ renderConvList(); updateMsgBadge(); subscribeMessages(); } else { unsubscribeMessages(); }
  if(s==='saved') renderSaved();
  if(s==='profile') renderMyProfile();
}
function toggleSB(){ document.getElementById('sidebar')?.classList.toggle('open'); document.getElementById('sbo')?.classList.toggle('sh'); }
function closeSB(){ document.getElementById('sidebar')?.classList.remove('open'); document.getElementById('sbo')?.classList.remove('sh'); }

// ═══════ DISCOVER ═══════
let sPage=1; const PP=9;
function popFilters(){
  const FLDS=['Accounting','Architecture','Artificial Intelligence','Biology','Biotechnology','Business Administration','Chemistry','Civil Engineering','Computer Science','Data Science','Design','Economics','Education','Electrical Engineering','Entrepreneurship','Environmental Science','Finance','History','International Relations','Journalism','Law','Literature','Marketing','Mathematics','Mechanical Engineering','Medicine','Music','Neuroscience','Nursing','Philosophy','Physics','Political Science','Psychology','Public Health','Sociology','Software Engineering'];
  const GOALS=['Study partners','Project collaborators','Startup co-founders','Build CV / portfolio','Internship opportunities','Mentorship','Research collaboration','College application prep','Networking','Looking for friends'];
  const FCTRS=CTRS;
  const FLAS=LAS;
  function addOpts(id,items){ const el=document.getElementById(id); if(!el||el.options.length>1) return; items.forEach(v=>{ const o=document.createElement('option'); o.textContent=v; el.appendChild(o); }); }
  addOpts('f-co',FCTRS); addOpts('f-fi',FLDS); addOpts('f-go',GOALS); addOpts('f-la',FLAS);
}
function clearFilters(){ ['f-co','f-fi','f-st','f-go','f-la'].forEach(id=>{ const e=document.getElementById(id); if(e) e.value=''; }); const qs=document.getElementById('qs'); if(qs) qs.value=''; sPage=1; runSearch(); }
async function runSearch(){
  const q=(document.getElementById('qs')?.value||'').trim();
  const co=document.getElementById('f-co')?.value||'';
  const fi=document.getElementById('f-fi')?.value||'';
  const st=document.getElementById('f-st')?.value||'';
  const go=document.getElementById('f-go')?.value||'';
  const la=document.getElementById('f-la')?.value||'';
  const { data, error } = await sb.rpc('search_profiles', {
    p_query:q||null, p_country:co||null, p_field:fi||null, p_status:st||null,
    p_goal:go||null, p_language:la||null, p_page:sPage, p_page_size:PP,
  });
  const grid=document.getElementById('rgrid');
  if(error){ console.error(error); if(grid) grid.innerHTML='<div class="empty" style="grid-column:1/-1"><h3>Search failed</h3></div>'; return; }
  const rows=data||[];
  const tot = rows.length ? Number(rows[0].total_count) : 0;
  const pages=Math.max(1, Math.ceil(tot/PP));
  if(sPage>pages && pages>=1 && sPage!==1){ sPage=1; return runSearch(); }
  const users = rows.map(mapCard);
  const rinfo=document.getElementById('r-info'); if(rinfo) rinfo.textContent=tot+' people found';
  if(!grid) return;
  if(!users.length){ grid.innerHTML=`<div class="empty" style="grid-column:1/-1"><h3>No results</h3><p style="color:var(--text3)">Try adjusting your filters.</p></div>`; const pgn0=document.getElementById('pgn'); if(pgn0) pgn0.innerHTML=''; return; }
  grid.innerHTML = users.map((u,i)=>`
    <div class="rc fin" style="animation-delay:${i*.04}s">
      <div class="rch"><div class="rcav" style="background:${ac(u.id)}">${ah(u)}</div><div><div class="rcn">${u.fn} ${u.ln}</div><div class="rcf">${u.fi||''}</div></div></div>
      ${u.ci?`<div class="rclc">📍 ${u.ci}${u.co?', '+u.co:''}${u.st?' · '+u.st:''}</div>`:''}
      <div class="rcb">${u.bio||'No bio yet.'}</div>
      <div class="rcts">${(u.int||[]).slice(0,3).map(t=>`<span class="tag">${t}</span>`).join('')}</div>
      <div style="display:flex;gap:7px">
        <button class="btn btn-ghost btn-sm" style="flex:1;justify-content:center" onclick="viewProfile('${u.un}')">View profile</button>
        <button class="btn btn-primary btn-sm" onclick="startChat('${u.id}')" title="Message">💬</button>
        <button class="bookmark-btn${isSaved(u.id)?' saved':''}" data-uid="${u.id}" onclick="toggleSave(this.dataset.uid,this)" style="padding:6px 10px;border-radius:var(--r);border:1.5px solid var(--border);background:none;cursor:pointer;font-size:15px" title="Save">🔖</button>
      </div>
    </div>`).join('');
  const pgn=document.getElementById('pgn');
  if(pgn){
    if(pages>1){ let h=''; if(sPage>1) h+=`<button class="pg" onclick="goP(${sPage-1})">‹</button>`; for(let i=1;i<=pages;i++) h+=`<button class="pg${i===sPage?' ac':''}" onclick="goP(${i})">${i}</button>`; if(sPage<pages) h+=`<button class="pg" onclick="goP(${sPage+1})">›</button>`; pgn.innerHTML=h; }
    else pgn.innerHTML='';
  }
}
function goP(n){ sPage=n; runSearch(); document.getElementById('sec-discover')?.scrollIntoView({behavior:'smooth'}); }
function debSearch(){
  clearTimeout(window._st);
  window._st=setTimeout(()=>{ const q=(document.getElementById('qs')||{}).value||''; if(q.length>=2) saveSearchHistory(q); sPage=1; runSearch(); }, 320);
}
function toggleFilters(){
  const fp=document.querySelector('.fp'); if(!fp) return;
  fp.classList.toggle('mobile-open');
  const btn=document.getElementById('filter-toggle'); if(btn) btn.textContent = fp.classList.contains('mobile-open') ? '✕ Close' : '⚙️ Filters';
}

// ═══════ PROFILE VIEW ═══════
async function viewProfile(username){
  if(!username) return;
  const { data, error } = await sb.rpc('get_profile_card', { p_username: username });
  const row = data && data[0];
  if(error || !row){ toast('Profile not found','err'); showSec('discover'); return; }
  const u = mapProfilePage(row);
  const col = ac(u.id);
  const socs=[
    u.tg?`<a class="slk" href="https://t.me/${u.tg.replace('@','')}" target="_blank">✈️ Telegram</a>`:'',
    u.ig?`<a class="slk" href="https://instagram.com/${u.ig.replace('@','')}" target="_blank">📸 Instagram</a>`:'',
    u.wa?`<a class="slk" href="https://wa.me/${u.wa.replace(/\D/g,'')}" target="_blank">💬 WhatsApp</a>`:'',
    u.li?`<a class="slk" href="https://${u.li.replace('https://','')}" target="_blank">💼 LinkedIn</a>`:'',
    u.emp?`<a class="slk" href="mailto:${u.emp}">📧 Email</a>`:'',
  ].filter(Boolean).join('');
  const cont=document.getElementById('vp-cont'); if(!cont) return;
  cont.innerHTML = `
    <div class="phc">
      <div class="phi">
        <div class="phav" style="background:${col}">${ah(u)}</div>
        <div class="phin">
          <h1>${u.fn} ${u.ln}</h1>
          <div class="phun">@${u.un}</div>
          <div class="phm">
            ${u.ci?`<div class="phmi">📍 ${u.ci}${u.co?', '+u.co:''}</div>`:''}
            ${u.fi?`<div class="phmi">🎓 ${u.fi}</div>`:''}
            ${u.uni?`<div class="phmi">🏫 ${u.uni}</div>`:''}
            ${u.jd?`<div class="phmi">📅 Joined ${u.jd}</div>`:''}
          </div>
          ${socs?`<div class="slks">${socs}</div>`:''}
        </div>
      </div>
    </div>
    <div class="pbody">
      <div>
        ${u.bio?`<div class="psec"><h3>✍️ About</h3><p class="pbio">${u.bio}</p></div>`:''}
        ${(u.gl||[]).length?`<div class="psec"><h3>🎯 Goals</h3><div class="rcts">${u.gl.map(g=>`<span class="tag">${g}</span>`).join('')}</div></div>`:''}
        ${(u.int||[]).length?`<div class="psec"><h3>💡 Interests</h3><div class="rcts">${u.int.map(i=>`<span class="tag">${i}</span>`).join('')}</div></div>`:''}
      </div>
      <div>
        <div class="psec"><h3>📋 Details</h3>
          <table class="dt">
            ${u.st?`<tr><td>Status</td><td>${u.st}</td></tr>`:''}
            ${u.yr?`<tr><td>Year</td><td>${u.yr}</td></tr>`:''}
            ${u.rg?`<tr><td>Region</td><td>${u.rg}</td></tr>`:''}
            ${u.co?`<tr><td>Country</td><td>${u.co}</td></tr>`:''}
          </table>
        </div>
        ${(u.la||[]).length?`<div class="psec"><h3>🌐 Languages</h3><div class="rcts">${u.la.map(l=>`<span class="tag">${l}</span>`).join('')}</div></div>`:''}
        <div class="psec">
          <h3>⚑ Report</h3>
          <p style="font-size:13px;margin-bottom:9px">If this profile violates our guidelines.</p>
          <button class="btn btn-primary btn-sm" style="width:100%;justify-content:center;margin-bottom:8px" onclick="startChat('${u.id}')">💬 Send message</button>
          <button class="btn btn-ghost btn-sm" onclick="reportUser('${u.id}')">Report this profile</button>
        </div>
      </div>
    </div>`;
  showSec('vp');
}
function reportUser(id){
  openModal('Report user','Why are you reporting this profile?',
    `<div class="fg"><label class="fl">Reason</label><select class="fi" id="rep-rs"><option>Fake profile</option><option>Spam</option><option>Inappropriate content</option><option>Harassment</option><option>Other</option></select></div>
     <div class="fg"><label class="fl">Details (optional)</label><textarea class="fi" id="rep-dt" rows="3" placeholder="Describe the issue…"></textarea></div>`,
    [{l:'Cancel',c:'btn btn-ghost btn-sm',f:'closeModal()'},{l:'Submit report',c:'btn btn-primary btn-sm',f:`subReport('${id}')`}]);
}
async function subReport(uid){
  const rs=document.getElementById('rep-rs')?.value||'Other';
  const dt=document.getElementById('rep-dt')?.value||'';
  const { error } = await sb.from('reports').insert({ target_id: uid, reporter_id: SESSION.user.id, reason: rs, details: dt||null });
  closeModal();
  toast(error ? 'Could not submit report' : 'Report submitted. We\'ll review it shortly.', error?'err':'ok');
}

// ═══════ MY PROFILE ═══════
function renderMyProfile(){
  const m=me(); if(!m) return;
  const prv = MY_PRIVACY || { loc:true,uni:true,soc:true,jd:true };
  const col=ac(m.id);
  const socs=[
    m.tg?`<span class="slk">✈️ ${m.tg}</span>`:'',
    m.ig?`<span class="slk">📸 ${m.ig}</span>`:'',
    m.wa?`<span class="slk">💬 ${m.wa}</span>`:'',
    m.li?`<span class="slk">💼 LinkedIn</span>`:'',
    m.emp?`<span class="slk">📧 ${m.emp}</span>`:'',
  ].filter(Boolean).join('');
  const cont=document.getElementById('mp-cont'); if(!cont) return;
  cont.innerHTML = `
    <div class="phc">
      <div class="phi">
        <div class="phav" style="background:${col}">${ah(m)}</div>
        <div class="phin">
          <h1>${m.fn} ${m.ln}</h1>
          <div class="phun">@${m.un}</div>
          <div class="phm">
            ${prv.loc&&m.ci?`<div class="phmi">📍 ${m.ci}${m.co?', '+m.co:''}</div>`:''}
            ${m.fi?`<div class="phmi">🎓 ${m.fi}</div>`:''}
            ${prv.uni&&m.uni?`<div class="phmi">🏫 ${m.uni}</div>`:''}
            ${prv.jd&&m.jd?`<div class="phmi">📅 Joined ${m.jd}</div>`:''}
          </div>
          ${prv.soc&&socs?`<div class="slks">${socs}</div>`:'<p style="font-size:12px;color:var(--text3);margin-top:7px">Social links hidden by privacy settings</p>'}
        </div>
      </div>
    </div>
    <div class="pbody">
      <div>
        <div class="psec"><h3>✍️ About</h3><p class="pbio">${m.bio||'<span style="color:var(--text3)">No bio yet. <a onclick="showSec(\'edit-profile\')">Add one →</a></span>'}</p></div>
        ${(m.gl||[]).length?`<div class="psec"><h3>🎯 Goals</h3><div class="rcts">${m.gl.map(g=>`<span class="tag">${g}</span>`).join('')}</div></div>`:''}
        ${(m.int||[]).length?`<div class="psec"><h3>💡 Interests</h3><div class="rcts">${m.int.map(i=>`<span class="tag">${i}</span>`).join('')}</div></div>`:''}
      </div>
      <div>
        <div class="psec"><h3>📋 Details</h3>
          <table class="dt">
            ${m.st?`<tr><td>Status</td><td>${m.st}</td></tr>`:''}
            ${m.yr?`<tr><td>Year</td><td>${m.yr}</td></tr>`:''}
            ${m.rg?`<tr><td>Region</td><td>${m.rg}</td></tr>`:''}
            ${m.co?`<tr><td>Country</td><td>${m.co}</td></tr>`:''}
            ${m.jd?`<tr><td>Joined</td><td>${m.jd}</td></tr>`:''}
          </table>
        </div>
        ${(m.la||[]).length?`<div class="psec"><h3>🌐 Languages</h3><div class="rcts">${m.la.map(l=>`<span class="tag">${l}</span>`).join('')}</div></div>`:''}
        <div class="psec"><p style="font-size:12px;color:var(--text3)">Some fields may be hidden. Manage in <a onclick="showSec('settings');showStab('prv',document.querySelector('.sni'))">Privacy settings</a>.</p></div>
      </div>
    </div>`;
}

// ═══════ EDIT PROFILE ═══════
function popEP(){
  const m=me(); if(!m) return;
  const F={'ep-fn':m.fn,'ep-ln':m.ln,'ep-un':m.un,'ep-fi':m.fi,'ep-uni':m.uni,'ep-ci':m.ci,'ep-co':m.co,'ep-bio':m.bio,'ep-tg':m.tg,'ep-ig':m.ig,'ep-wa':m.wa,'ep-li':m.li,'ep-em':m.emp};
  Object.entries(F).forEach(([id,val])=>{ const e=document.getElementById(id); if(e) e.value=val||''; });
  const bc=document.getElementById('ep-cnt'); if(bc) bc.textContent=(m.bio||'').length+'/300';
  const av=document.getElementById('ep-av');
  if(av){ av.style.background=ac(m.id); av.innerHTML = m.av ? `<img src="${m.av}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">` : (m.fn[0]+(m.ln?m.ln[0]:'')).toUpperCase(); }
}
async function uploadAv(evt){
  const file=evt.target.files[0]; if(!file) return;
  if(!file.type.startsWith('image/')) return toast('Please choose an image file','err');
  if(file.size > 5*1024*1024) return toast('Image must be under 5MB','err');
  const ext=(file.name.split('.').pop()||'jpg').toLowerCase();
  const path=`${SESSION.user.id}/avatar.${ext}`;
  const { error: upErr } = await sb.storage.from('avatars').upload(path, file, { upsert:true, cacheControl:'3600' });
  if(upErr){ toast('Upload failed: '+upErr.message,'err'); return; }
  const { data: pub } = sb.storage.from('avatars').getPublicUrl(path);
  const url = pub.publicUrl + '?v=' + Date.now();
  const { error: updErr } = await sb.from('profiles').update({ avatar_url:url }).eq('id', SESSION.user.id);
  if(updErr){ toast('Could not save photo','err'); return; }
  ME.av=url;
  popEP(); updSBav(); renderMyProfile();
  toast('Photo updated ✓','ok');
}
async function removeAv(){
  const m=me(); if(!m) return;
  try{ await sb.storage.from('avatars').remove(['jpg','jpeg','png','webp','gif'].map(ext=>`${SESSION.user.id}/avatar.${ext}`)); }catch(e){}
  await sb.from('profiles').update({ avatar_url:null }).eq('id', SESSION.user.id);
  ME.av='';
  popEP(); updSBav(); renderMyProfile();
  toast('Photo removed');
}
async function saveProfile(){
  const m=me(); if(!m) return;
  const v=id=>(document.getElementById(id)?.value||'').trim();
  const newUN=v('ep-un');
  if(newUN && newUN.toLowerCase()!==m.un.toLowerCase()){
    const { data: available } = await sb.rpc('is_username_available', { p_username:newUN });
    if(available===false){ toast('Username already taken','err'); return; }
  }
  const payload={
    first_name: v('ep-fn')||m.fn, last_name: v('ep-ln')||m.ln, username: newUN||m.un,
    field: v('ep-fi'), university: v('ep-uni')||null, city: v('ep-ci'), country: v('ep-co'),
    bio: document.getElementById('ep-bio')?.value||'',
    telegram: v('ep-tg')||null, instagram: v('ep-ig')||null, whatsapp: v('ep-wa')||null,
    linkedin: v('ep-li')||null, public_email: v('ep-em')||null,
  };
  const { error } = await sb.from('profiles').update(payload).eq('id', SESSION.user.id);
  if(error){ toast(error.code==='23505' ? 'Username already taken' : 'Could not save profile','err'); return; }
  await loadMyProfile();
  const sbn=document.getElementById('sb-nm'); if(sbn) sbn.textContent=ME.fn+' '+ME.ln;
  renderMyProfile(); toast('Profile saved ✓','ok'); showSec('profile');
}

// ═══════ SETTINGS ═══════
function showStab(t,btn){
  ['acc','prv','sec','del'].forEach(k=>{ const e=document.getElementById('st-'+k); if(e) e.style.display='none'; });
  const tg=document.getElementById('st-'+t); if(tg) tg.style.display='block';
  document.querySelectorAll('.sni').forEach(b=>b.classList.remove('ac'));
  if(btn) btn.classList.add('ac');
}
function popStSettings(){
  const m=me(); if(!m) return;
  const dn=document.getElementById('st-dn'); if(dn) dn.value=m.fn+' '+m.ln;
  const un=document.getElementById('st-un'); if(un) un.value=m.un||'';
  const em=document.getElementById('cur-em'); if(em) em.textContent=m.em||'';
}
async function saveStAcc(){
  const m=me(); if(!m) return;
  const dn=(document.getElementById('st-dn')?.value||'').trim();
  const un=(document.getElementById('st-un')?.value||'').trim();
  if(!dn) return setMsg('st-acc-msg','Name required','err');
  if(un && un.toLowerCase()!==m.un.toLowerCase()){
    const { data: available } = await sb.rpc('is_username_available', { p_username: un });
    if(available===false) return setMsg('st-acc-msg','Username taken','err');
  }
  const parts=dn.split(' ');
  const payload={ first_name:parts[0], last_name:parts.slice(1).join(' ')||'' };
  if(un) payload.username=un;
  const { error } = await sb.from('profiles').update(payload).eq('id', SESSION.user.id);
  if(error) return setMsg('st-acc-msg', error.code==='23505' ? 'Username taken' : 'Could not save','err');
  await loadMyProfile();
  const sbn=document.getElementById('sb-nm'); if(sbn) sbn.textContent=ME.fn+' '+ME.ln;
  const sbr=document.getElementById('sb-rl'); if(sbr) sbr.textContent=ME.st||'Member';
  popEP(); renderMyProfile();
  setMsg('st-acc-msg','Saved ✓','ok');
}
function loadPrivToggles(){
  const p = MY_PRIVACY || { loc:true,uni:true,soc:true,srch:true,jd:true };
  const M={loc:'p-loc',uni:'p-uni',soc:'p-soc',srch:'p-srch',jd:'p-jd'};
  Object.entries(M).forEach(([k,id])=>{ const e=document.getElementById(id); if(e){ if(p[k]===false) e.classList.remove('on'); else e.classList.add('on'); } });
}
async function savePrivacy(){
  if(!SESSION) return;
  const val=id=>document.getElementById(id)?.classList.contains('on')!==false;
  const payload={ show_location:val('p-loc'), show_university:val('p-uni'), show_socials:val('p-soc'), show_in_search:val('p-srch'), show_join_date:val('p-jd') };
  const { error } = await sb.from('privacy_settings').update(payload).eq('profile_id', SESSION.user.id);
  if(error){ toast('Could not save privacy settings','err'); return; }
  MY_PRIVACY = { loc:payload.show_location, uni:payload.show_university, soc:payload.show_socials, srch:payload.show_in_search, jd:payload.show_join_date };
  toast('Privacy saved ✓','ok');
}
function pwdStr(inp, barId, lblId){
  barId = barId || 'pbar'; lblId = lblId || 'plbl';
  const isSettings = barId!=='pbar';
  const v=inp.value;
  const bar=document.getElementById(barId); const lbl=document.getElementById(lblId);
  if(!bar) return;
  const base = isSettings ? 'pwd-strength' : 'pb';
  let sc=0; if(v.length>=8) sc++; if(/[A-Z]/.test(v)) sc++; if(/[0-9]/.test(v)) sc++; if(/[^A-Za-z0-9]/.test(v)) sc++;
  if(!v){ bar.className=base; if(lbl) lbl.textContent=''; return; }
  if(sc<=1){ bar.className=base+' w'; if(lbl) lbl.textContent='Weak'; }
  else if(sc<=2){ bar.className=base+' m'; if(lbl) lbl.textContent='Medium'; }
  else{ bar.className=base+' s'; if(lbl) lbl.textContent='Strong'; }
}
async function changePass(){
  const m=me(); if(!m) return;
  const op=document.getElementById('st-op')?.value;
  const np=document.getElementById('st-np')?.value;
  const cp=document.getElementById('st-cp')?.value;
  if(!op||!np||!cp) return setMsg('st-pw-msg','Fill in all fields','err');
  if(np.length<8) return setMsg('st-pw-msg','New password must be 8+ characters','err');
  if(np!==cp) return setMsg('st-pw-msg','Passwords do not match','err');
  const { error: verifyErr } = await sb.auth.signInWithPassword({ email:m.em, password:op });
  if(verifyErr) return setMsg('st-pw-msg','Current password is incorrect','err');
  const { error } = await sb.auth.updateUser({ password:np });
  if(error) return setMsg('st-pw-msg', error.message,'err');
  ['st-op','st-np','st-cp'].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=''; });
  setMsg('st-pw-msg','Password updated ✓','ok');
}
async function changeEmail(){
  const m=me(); if(!m) return;
  const ne=(document.getElementById('st-ne')?.value||'').trim();
  const pw=document.getElementById('st-ep')?.value;
  if(!ne||!pw) return setMsg('st-em-msg','Fill in all fields','err');
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ne)) return setMsg('st-em-msg','Invalid email format','err');
  const { error: verifyErr } = await sb.auth.signInWithPassword({ email:m.em, password:pw });
  if(verifyErr) return setMsg('st-em-msg','Incorrect password','err');
  const { error } = await sb.auth.updateUser({ email:ne });
  if(error) return setMsg('st-em-msg', /registered/i.test(error.message) ? 'Email already in use' : error.message,'err');
  ['st-ne','st-ep'].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=''; });
  setMsg('st-em-msg','Confirmation link sent to your new email address ✓','ok');
}
function confirmDeleteAcc(){
  openModal('Delete account','This will permanently delete your profile and all your data. Type DELETE to confirm.',
    '<div class="fg"><label class="fl">Type DELETE to confirm</label><input class="fi" id="del-conf" placeholder="DELETE"></div>',
    [{l:'Cancel',c:'btn btn-ghost btn-sm',f:'closeModal()'},{l:'Delete forever',c:'btn btn-danger btn-sm',f:'deleteMyAcc()'}]);
}
async function deleteMyAcc(){
  if((document.getElementById('del-conf')?.value||'')!=='DELETE'){ toast('Type DELETE to confirm','err'); return; }
  const { error } = await sb.functions.invoke('delete-account', { method:'POST' });
  if(error){ toast('Could not delete account. Please try again.','err'); return; }
  await sb.auth.signOut();
  SESSION=null; ME=null;
  closeModal(); toast('Account deleted'); setTimeout(()=>showPage('landing'),500);
}

// ═══════ PHASE 2 STUBS ═══════
// The admin panel and notifications nav items are hidden (see bootApp),
// so these are unreachable through normal navigation. They're defined
// anyway so nothing throws a ReferenceError if the underlying markup
// (still present in the DOM, just hidden) is ever reached directly.
function loadAdmUsers(){ toast('Admin panel is not available yet.','err'); }
function markAllRead(){ toast('Notifications are not available yet.','err'); }

// ═══════ MODAL / TOAST ═══════
function openModal(title,desc,extra,btns){
  const t=document.getElementById('modal-title'); if(t) t.textContent=title;
  const d=document.getElementById('modal-msg'); if(d) d.innerHTML=desc;
  const x=document.getElementById('modal-extra'); if(x) x.innerHTML=extra||'';
  const a=document.getElementById('modal-actions'); if(a) a.innerHTML=btns.map(b=>`<button class="${b.c}" onclick="${b.f}">${b.l}</button>`).join('');
  document.getElementById('modal')?.classList.add('sh');
}
function closeModal(){ document.getElementById('modal')?.classList.remove('sh'); }
function toast(msg,type=''){
  const t=document.getElementById('toast'); if(!t) return;
  t.textContent=msg; t.className='toast'+(type?' '+type:'');
  void t.offsetWidth; t.classList.add('sh');
  clearTimeout(t._t); t._t=setTimeout(()=>t.classList.remove('sh'),3000);
}

// ═══════ SAVED PROFILES ═══════
async function toggleSave(userId, btn){
  if(!SESSION) return;
  if(SAVED_IDS.has(userId)){
    await sb.from('saved_profiles').delete().eq('user_id', SESSION.user.id).eq('saved_profile_id', userId);
    SAVED_IDS.delete(userId);
    if(btn){ btn.classList.remove('saved'); btn.title='Save profile'; }
    toast('Removed from saved');
  } else {
    const { error } = await sb.from('saved_profiles').insert({ user_id: SESSION.user.id, saved_profile_id: userId });
    if(error){ toast('Could not save profile','err'); return; }
    SAVED_IDS.add(userId);
    if(btn){ btn.classList.add('saved'); btn.title='Saved!'; }
    toast('Profile saved! 🔖','ok');
  }
  const secSaved=document.getElementById('sec-saved');
  if(secSaved && secSaved.classList.contains('sh')) renderSaved();
}
async function renderSaved(){
  const el=document.getElementById('saved-list'); if(!el) return;
  const { data, error } = await sb.from('saved_profiles').select('saved_profile_id, created_at').eq('user_id', SESSION.user.id).order('created_at',{ascending:false});
  if(error || !data || !data.length){
    el.innerHTML='<div class="empty"><div style="font-size:36px;margin-bottom:12px">🔖</div><h3>No saved profiles yet</h3><p style="color:var(--text4)">Click the bookmark icon on any profile to save it here.</p></div>';
    return;
  }
  const ids=data.map(r=>r.saved_profile_id);
  const { data: idRows } = await sb.rpc('get_identities', { p_ids: ids });
  const users=(idRows||[]).map(mapCard);
  el.innerHTML='<div class="rg-grid">'+users.map(u=>`
    <div class="rc fin">
      <div class="rch">
        <div class="rcav" style="background:${ac(u.id)}">${ah(u)}</div>
        <div><div class="rcn">${u.fn} ${u.ln}</div><div class="rcf">${u.fi||''}</div></div>
        <button class="bookmark-btn saved" data-uid="${u.id}" onclick="toggleSave(this.dataset.uid,this)" title="Remove">🔖</button>
      </div>
      ${u.ci?`<div class="rclc">📍 ${u.ci}${u.co?', '+u.co:''}</div>`:''}
      <div class="rcb">${u.bio||'No bio yet.'}</div>
      <div class="rcts">${(u.int||[]).slice(0,3).map(t=>`<span class="tag">${t}</span>`).join('')}</div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-ghost btn-sm" style="flex:1;justify-content:center" data-uid="${u.id}" onclick="viewProfile('${u.un}')">View profile</button>
        <button class="btn btn-primary btn-sm" data-uid="${u.id}" onclick="startChat('${u.id}')" title="Message">💬</button>
      </div>
    </div>`).join('') + '</div>';
}

// ═══════ MESSAGING ═══════
let activeChatId=null;   // other user's id
let activeConvId=null;
let CONV_CACHE=new Map();
let REALTIME_CH=null;

function pairKey(a,b){ return a<b ? [a,b] : [b,a]; }
async function ensureConversation(otherId){
  if(CONV_CACHE.has(otherId)) return CONV_CACHE.get(otherId);
  const meId=SESSION.user.id;
  const [a,b]=pairKey(meId, otherId);
  let { data: existing } = await sb.from('conversations').select('id').eq('user_a',a).eq('user_b',b).maybeSingle();
  if(!existing){
    const { data: created, error } = await sb.from('conversations').insert({ user_a:a, user_b:b }).select('id').single();
    if(error){
      const retry = await sb.from('conversations').select('id').eq('user_a',a).eq('user_b',b).maybeSingle();
      existing = retry.data;
    } else existing = created;
  }
  if(existing) CONV_CACHE.set(otherId, existing.id);
  return existing ? existing.id : null;
}
async function startChat(userId){
  await ensureConversation(userId);
  showSec('messages');
  await openChat(userId);
}
async function openChat(userId){
  if(typeof userId==='object') userId=userId.dataset.id;
  activeChatId=userId;
  activeConvId=await ensureConversation(userId);
  const { data: idRows } = await sb.rpc('get_identities', { p_ids:[userId] });
  const u = idRows && idRows[0] ? mapCard(idRows[0]) : null;
  if(!u) return;
  const avEl=document.getElementById('chat-av');
  if(avEl){ avEl.style.background=ac(u.id); avEl.innerHTML = u.av ? `<img src="${u.av}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">` : ((u.fn||'?')[0]+(u.ln?u.ln[0]:'')).toUpperCase(); }
  const cn=document.getElementById('chat-name'); if(cn) cn.textContent=(u.fn||'')+' '+(u.ln||'');
  const cf=document.getElementById('chat-field'); if(cf) cf.textContent=u.fi||'';
  const ce=document.getElementById('chat-empty'); if(ce) ce.style.display='none';
  const ca=document.getElementById('chat-active'); if(ca) ca.style.display='flex';
  document.querySelectorAll('.conv-item').forEach(el=>el.classList.remove('active'));
  document.getElementById('conv-'+userId)?.classList.add('active');
  await markSeen();
  await renderMessages();
  subscribeMessages();
  document.getElementById('chat-input')?.focus();
}
async function markSeen(){
  if(!activeConvId || !SESSION) return;
  await sb.from('messages').update({ seen_at: new Date().toISOString() })
    .eq('conversation_id', activeConvId).neq('sender_id', SESSION.user.id).is('seen_at', null);
}
async function renderConvList(filter){
  filter = filter || '';
  const { data, error } = await sb.rpc('list_conversations');
  const el=document.getElementById('conv-items'); if(!el) return;
  if(error){ console.error(error); return; }
  let rows=data||[];
  if(!rows.length){ el.innerHTML='<div style="padding:24px 16px;text-align:center;color:var(--slate);font-size:13px">No conversations yet.<br>Find someone in Discover<br>and send them a message!</div>'; return; }
  const otherIds=rows.map(r=>r.other_user_id);
  const { data: idRows } = await sb.rpc('get_identities', { p_ids: otherIds });
  const idMap=new Map((idRows||[]).map(r=>[r.id, mapCard(r)]));
  if(filter) rows=rows.filter(r=>{ const u=idMap.get(r.other_user_id); if(!u) return false; return ((u.fn||'')+(u.ln||'')).toLowerCase().includes(filter.toLowerCase()); });
  el.innerHTML = rows.map(r=>{
    const u=idMap.get(r.other_user_id); if(!u) return '';
    const avHTML = u.av ? `<img src="${u.av}" style="width:40px;height:40px;object-fit:cover;border-radius:50%">` : ah(u);
    const preview = r.last_message_body ? (r.last_message_sender===SESSION.user.id?'You: ':'')+r.last_message_body.slice(0,38)+(r.last_message_body.length>38?'…':'') : 'No messages yet';
    const timeStr = r.last_message_at ? fmtMsgTime(new Date(r.last_message_at).getTime()) : '';
    const unread = Number(r.unread_count||0);
    return `<div class="conv-item${activeChatId===r.other_user_id?' active':''}" id="conv-${r.other_user_id}" style="cursor:pointer" onclick="openChat(this.dataset.id)" data-id="${r.other_user_id}">
      <div class="conv-av" style="background:${ac(u.id)}">${avHTML}</div>
      <div class="conv-info"><div class="conv-name">${u.fn} ${u.ln}</div><div class="conv-preview">${escapeHTML(preview)}</div></div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
        <span style="font-size:11px;color:var(--slate)">${timeStr}</span>
        ${unread?`<span class="conv-unread">${unread}</span>`:''}
      </div></div>`;
  }).join('');
}
async function renderMessages(){
  const el=document.getElementById('chat-messages'); if(!el || !activeConvId) return;
  const { data, error } = await sb.from('messages').select('*').eq('conversation_id', activeConvId).order('created_at',{ascending:true});
  if(error){ console.error(error); return; }
  const msgs=data||[]; const meId=SESSION.user.id;
  if(!msgs.length){ el.innerHTML='<div style="text-align:center;color:var(--slate);font-size:13px;margin:auto">No messages yet. Say hello! 👋</div>'; return; }
  let lastDate='';
  el.innerHTML = msgs.map(m=>{
    const isMine=m.sender_id===meId;
    const d=new Date(m.created_at).toLocaleDateString('en-US',{weekday:'long',month:'short',day:'numeric'});
    const divider = d!==lastDate ? `<div class="msg-day">${d}</div>` : '';
    lastDate=d;
    const time=new Date(m.created_at).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'});
    const ticks = isMine ? (m.seen_at?'<span class="tick-seen">✓✓</span>':'<span class="tick-sent">✓</span>') : '';
    return divider+`<div class="msg-bubble ${isMine?'mine':'theirs'}">${escapeHTML(m.body)}<div class="msg-meta"><span class="msg-time">${time}</span>${ticks}</div></div>`;
  }).join('');
  el.scrollTop=el.scrollHeight;
}
async function sendMessage(){
  const input=document.getElementById('chat-input');
  const text=(input?.value||'').trim();
  if(!text || !activeConvId || !SESSION) return;
  const { error } = await sb.from('messages').insert({ conversation_id: activeConvId, sender_id: SESSION.user.id, body: text });
  if(error){ toast('Message failed to send','err'); return; }
  input.value=''; input.style.height='auto';
  await renderMessages(); await renderConvList(document.getElementById('conv-search')?.value||''); await updateMsgBadge();
}
function chatKeyDown(e){ if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); sendMessage(); } }
function autoResizeTA(el){ el.style.height='auto'; el.style.height=Math.min(el.scrollHeight,100)+'px'; }
function filterConvs(){ renderConvList(document.getElementById('conv-search')?.value||''); }
async function viewProfileFromChat(){
  if(!activeChatId) return;
  const { data } = await sb.rpc('get_identities', { p_ids:[activeChatId] });
  const u = data && data[0];
  if(u) viewProfile(u.username);
}
async function updateMsgBadge(){
  const { data } = await sb.rpc('list_conversations');
  const total=(data||[]).reduce((a,r)=>a+Number(r.unread_count||0),0);
  const badge=document.getElementById('msg-badge'); if(!badge) return;
  badge.style.display = total>0?'inline':'none';
  badge.textContent = total>99?'99+':total;
}
// Realtime — replaces the original prototype's 3-second polling
// (`setInterval(...,3000)`). Supabase Realtime enforces the same
// RLS SELECT policies as normal queries, so this channel only ever
// delivers rows this user is a participant in.
function subscribeMessages(){
  unsubscribeMessages();
  if(!SESSION) return;
  REALTIME_CH = sb.channel('inbox-'+SESSION.user.id)
    .on('postgres_changes', { event:'INSERT', schema:'public', table:'messages' }, payload=>{
      const row=payload.new;
      if(row.conversation_id===activeConvId){ renderMessages(); if(row.sender_id!==SESSION.user.id) markSeen(); }
      renderConvList(document.getElementById('conv-search')?.value||'');
      updateMsgBadge();
    })
    .on('postgres_changes', { event:'UPDATE', schema:'public', table:'messages' }, payload=>{
      if(payload.new.conversation_id===activeConvId) renderMessages();
    })
    .subscribe();
}
function unsubscribeMessages(){ if(REALTIME_CH){ sb.removeChannel(REALTIME_CH); REALTIME_CH=null; } }

// ═══════ SEARCH HISTORY (local-only UI convenience, no backend needed) ═══════
function getSearchHistory(){ try{ return JSON.parse(localStorage.getItem('nklocal_search_history_'+(SESSION?SESSION.user.id:'')))||[]; }catch{ return []; } }
function saveSearchHistory(q){
  if(!q || q.length<2) return;
  let hist=getSearchHistory().filter(h=>h!==q);
  hist.unshift(q); hist=hist.slice(0,6);
  localStorage.setItem('nklocal_search_history_'+(SESSION?SESSION.user.id:''), JSON.stringify(hist));
}
function removeSearchHistoryItem(q){
  const hist=getSearchHistory().filter(h=>h!==q);
  localStorage.setItem('nklocal_search_history_'+(SESSION?SESSION.user.id:''), JSON.stringify(hist));
  showSearchHistory();
}
function showSearchHistory(){
  const hist=getSearchHistory(); const dd=document.getElementById('search-history-dropdown'); if(!dd) return;
  if(!hist.length){ dd.classList.remove('show'); return; }
  dd.innerHTML='<div class="sh-header"><span>Recent searches</span><span style="cursor:pointer" onclick="clearSearchHistory()">Clear all</span></div>'+
    hist.map(q=>`<div class="sh-item" onclick="applySearchHistory('${q.replace(/'/g,"\\'")}')"><span class="sh-icon">🕐</span><span>${q}</span><span class="sh-clear" onclick="event.stopPropagation();removeSearchHistoryItem('${q.replace(/'/g,"\\'")}')">✕</span></div>`).join('');
  dd.classList.add('show');
}
function hideSearchHistory(){ document.getElementById('search-history-dropdown')?.classList.remove('show'); }
function applySearchHistory(q){ const input=document.getElementById('qs'); if(input) input.value=q; hideSearchHistory(); sPage=1; runSearch(); }
function clearSearchHistory(){ localStorage.setItem('nklocal_search_history_'+(SESSION?SESSION.user.id:''), '[]'); hideSearchHistory(); }

// ═══════ SHARE / EXPORT (pure client-side, no backend needed) ═══════
function shareProfile(username){
  const link = window.location.origin + window.location.pathname + '?profile=' + (username||'');
  if(navigator.clipboard?.writeText) navigator.clipboard.writeText(link).then(()=>toast('Profile link copied! 🔗','ok')).catch(()=>prompt('Copy this link:', link));
  else prompt('Copy this link:', link);
}
function shareMyProfile(){ const m=me(); if(m) shareProfile(m.un); }
function exportProfilePDF(){
  const m=me(); if(!m) return;
  const prv = MY_PRIVACY || { loc:true,uni:true,soc:true,jd:true };
  const initials=((m.fn||'?')[0]+(m.ln?m.ln[0]:'')).toUpperCase();
  const avHTML = m.av
    ? `<img src="${m.av}" style="width:80px;height:80px;border-radius:50%;object-fit:cover;border:3px solid #E0E7FF">`
    : `<div style="width:80px;height:80px;border-radius:50%;background:#4F46E5;display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:700;color:#fff;font-family:Sora,sans-serif">${initials}</div>`;
  const socialLinks=[];
  if(prv.soc!==false){
    if(m.tg) socialLinks.push('Telegram: '+m.tg);
    if(m.li) socialLinks.push('LinkedIn: '+m.li);
    if(m.ig) socialLinks.push('Instagram: '+m.ig);
    if(m.wa) socialLinks.push('WhatsApp: '+m.wa);
    if(m.emp) socialLinks.push('Email: '+m.emp);
  }
  const html = '<!DOCTYPE html><html><head><meta charset="UTF-8">'+
    '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Sora:wght@700;800&display=swap" rel="stylesheet">'+
    '<title>'+m.fn+' '+m.ln+' — NetworkIt</title>'+
    '<style>body{font-family:Inter,sans-serif;color:#111827;margin:0;padding:40px;max-width:680px;margin:0 auto;-webkit-print-color-adjust:exact}h1,h2,h3{font-family:Sora,sans-serif;letter-spacing:-.02em}.header{display:flex;align-items:center;gap:24px;border-bottom:2px solid #E0E7FF;padding-bottom:28px;margin-bottom:28px}.name{font-size:28px;font-weight:800;color:#111827;margin:0 0 4px}.username{font-size:14px;color:#6B7280;margin:0 0 8px}.field{font-size:16px;font-weight:600;color:#4F46E5;margin:0 0 4px}.meta{font-size:13px;color:#6B7280}.section{margin-bottom:22px}.section h3{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#9CA3AF;margin-bottom:10px}.bio{font-size:15px;color:#374151;line-height:1.75}.tags{display:flex;flex-wrap:wrap;gap:6px}.tag{padding:4px 12px;border-radius:100px;background:#EEF2FF;color:#4F46E5;font-size:12px;font-weight:500}.social{font-size:13px;color:#374151;line-height:2}.footer{margin-top:36px;padding-top:16px;border-top:1px solid #E5E7EB;font-size:11px;color:#9CA3AF;display:flex;justify-content:space-between}.logo{font-family:Sora,sans-serif;font-weight:800;color:#4F46E5;font-size:14px}@media print{body{padding:20px}}</style></head><body>'+
    '<div class="header">'+avHTML+'<div><h1 class="name">'+(m.fn||'')+' '+(m.ln||'')+'</h1><p class="username">@'+(m.un||'')+'</p>'+(m.fi?'<p class="field">'+m.fi+'</p>':'')+'<p class="meta">'+[m.st,m.yr,(prv.uni!==false&&m.uni?m.uni:''),(prv.loc!==false&&m.ci?m.ci+(m.co?', '+m.co:''):'')].filter(Boolean).join(' · ')+'</p></div></div>'+
    (m.bio?'<div class="section"><h3>About</h3><p class="bio">'+m.bio+'</p></div>':'')+
    ((m.gl&&m.gl.length)?'<div class="section"><h3>Goals</h3><div class="tags">'+m.gl.map(g=>'<span class="tag">'+g+'</span>').join('')+'</div></div>':'')+
    ((m.int&&m.int.length)?'<div class="section"><h3>Interests</h3><div class="tags">'+m.int.map(i=>'<span class="tag">'+i+'</span>').join('')+'</div></div>':'')+
    ((m.la&&m.la.length)?'<div class="section"><h3>Languages</h3><div class="tags">'+m.la.map(l=>'<span class="tag">'+l+'</span>').join('')+'</div></div>':'')+
    (socialLinks.length?'<div class="section"><h3>Contact</h3><div class="social">'+socialLinks.join('<br>')+'</div></div>':'')+
    '<div class="footer"><span class="logo">NetworkIt</span><span>networkit.app · Professional Networking</span></div></body></html>';
  const blob=new Blob([html],{type:'text/html'});
  const url=URL.createObjectURL(blob);
  const win=window.open(url,'_blank');
  if(!win){ const a=document.createElement('a'); a.href=url; a.download=(m.fn||'profile')+'_networkit.html'; a.click(); toast('PDF saved as HTML file — open it and print to PDF','ok'); return; }
  setTimeout(()=>{ win.print(); URL.revokeObjectURL(url); }, 800);
}

// ═══════ THEME (pure local UI state) ═══════
function toggleTheme(){
  const isDark=document.body.classList.toggle('dark');
  localStorage.setItem('nk_theme', isDark?'dark':'light');
  const sbtn=document.getElementById('theme-toggle'); const nbtn=document.getElementById('nav-theme-btn');
  if(sbtn) sbtn.innerHTML = isDark?'☀️ Light mode':'🌙 Dark mode';
  if(nbtn) nbtn.textContent = isDark?'☀️':'🌙';
}
function applyTheme(){
  if(localStorage.getItem('nk_theme')==='dark'){
    document.body.classList.add('dark');
    const sbtn=document.getElementById('theme-toggle'); const nbtn=document.getElementById('nav-theme-btn');
    if(sbtn) sbtn.innerHTML='☀️ Light mode';
    if(nbtn) nbtn.textContent='☀️';
  }
}
(function(){ if(localStorage.getItem('nk_theme')==='dark') document.body.classList.add('dark'); })();

// ═══════ HERO CANVAS (pure decorative, no data) ═══════
function initCanvas(){
  const cv=document.getElementById('hero-canvas'); if(!cv) return;
  const ctx=cv.getContext('2d'); let W,H; const pts=[];
  const rsz=()=>{ W=cv.width=cv.parentElement.offsetWidth; H=cv.height=cv.parentElement.offsetHeight; };
  rsz(); window.addEventListener('resize',rsz);
  for(let i=0;i<50;i++) pts.push({ x:Math.random()*W, y:Math.random()*H, vx:(Math.random()-.5)*.25, vy:(Math.random()-.5)*.25, r:Math.random()*1.5+.5 });
  (function draw(){
    ctx.clearRect(0,0,W,H);
    pts.forEach((p,i)=>{
      p.x+=p.vx; p.y+=p.vy;
      if(p.x<0||p.x>W) p.vx*=-1; if(p.y<0||p.y>H) p.vy*=-1;
      ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2); ctx.fillStyle='rgba(79,70,229,.18)'; ctx.fill();
      for(let j=i+1;j<pts.length;j++){
        const q=pts[j], d=Math.hypot(p.x-q.x,p.y-q.y);
        if(d<120){ ctx.beginPath(); ctx.moveTo(p.x,p.y); ctx.lineTo(q.x,q.y); ctx.strokeStyle='rgba(79,70,229,'+(0.06*(1-d/120))+')'; ctx.lineWidth=.8; ctx.stroke(); }
      }
    });
    requestAnimationFrame(draw);
  })();
}

// ═══════ INIT ═══════
document.addEventListener('DOMContentLoaded', async () => {
  applyTheme();
  initCanvas();
  renderLanding();
  updateHeroStats();
  const modalEl=document.getElementById('modal');
  if(modalEl) modalEl.addEventListener('click', e=>{ if(e.target===modalEl) closeModal(); });

  await refreshSession();
  if(SESSION){
    await loadMyProfile();
    if(ME && ME.ban){ await sb.auth.signOut(); SESSION=null; ME=null; showPage('landing'); return; }
    if(ME){ showPage('app'); return; }
  }
  showPage('landing');

  sb.auth.onAuthStateChange((event, session) => {
    SESSION = session;
    if(event==='SIGNED_OUT'){ ME=null; showPage('landing'); }
  });
});

const _sp = showPage;
window.showPage = p => {
  _sp(p);
  if(p==='register') initReg();
  if(p==='login'){
    const e=document.getElementById('li-em'); const p2=document.getElementById('li-pw');
    if(e) e.value=''; if(p2) p2.value='';
    const er=document.getElementById('li-msg'); if(er) er.style.display='none';
  }
};
