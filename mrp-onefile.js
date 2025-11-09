// mrp-onefile.js
// مدرپ آفلاین/آنلاین + ادمن + آیدمپوتنسی

const http = require('http');
const fs   = require('fs');
const path = require('path');
const url  = require('url');
const crypto = require('crypto');

const ROOT = __dirname;
const DATA_DIR = ROOT;
const UPLOAD_DIR = path.join(ROOT, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const fUsers = path.join(DATA_DIR, 'users.json');
const fProducts = path.join(DATA_DIR, 'products.json');
const fPlans = path.join(DATA_DIR, 'plans.json');
const fVisits = path.join(DATA_DIR, 'visits.json');
const fOps = path.join(DATA_DIR, 'processed_ops.json');

// helpers
const readJSON = (fp, fallback=[]) => {
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); }
  catch { return Array.isArray(fallback) || typeof fallback==='object' ? JSON.parse(JSON.stringify(fallback)) : fallback; }
};
const writeJSON = (fp, data) => fs.writeFileSync(fp, JSON.stringify(data, null, 2));
const send = (res, code, body, headers={}) => {
  const h = Object.assign({'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-cache'}, headers);
  res.writeHead(code, h); res.end(typeof body==='string'?body:JSON.stringify(body));
};
const serve = (res, html) => {
  res.writeHead(200, {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-cache'});
  res.end(html);
};
const parseBody = (req) => new Promise((resolve,reject)=>{
  let b=''; req.on('data',ch=>{ b+=ch; if(b.length>10*1024*1024){reject('too big'); req.destroy();} });
  req.on('end',()=>{ try{ resolve(b?JSON.parse(b):{});}catch{resolve({});} });
});

const hash = s => crypto.createHash('sha256').update(s).digest('hex');
const jwtSecret = 'changeme_very_strong_12345'; // برای نسخه‌ی واقعی عوض کن

// auth (ساده: توکن در کوکی)
const cookieParse = (cookie='')=>{
  const out={}; cookie.split(';').forEach(p=>{ const [k,...r]=p.trim().split('='); if(k) out[k]=decodeURIComponent((r.join('=')||'')); });
  return out;
};
const sign = (payload)=> {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig  = crypto.createHmac('sha256', jwtSecret).update(data).digest('base64url');
  return data+'.'+sig;
};
const verify = (token)=>{
  if(!token) return null;
  const [data,sig]=token.split('.');
  const expect = crypto.createHmac('sha256', jwtSecret).update(data).digest('base64url');
  if(sig!==expect) return null;
  try{ return JSON.parse(Buffer.from(data,'base64url').toString()); }catch{ return null; }
};

// داده‌های اولیه
if(!fs.existsSync(fUsers)) writeJSON(fUsers, [
  {id:1, username:'admin', role:'admin', passhash:hash('admin')},
]);
if(!fs.existsSync(fProducts)) writeJSON(fProducts, [
  {id:1, brand:'اورموس', name:'ژل شستشوی پوست چرب'},
  {id:2, brand:'کانیبو', name:'ضدآفتاب بی‌رنگ'},
  {id:3, brand:'اورموس', name:'ژل شستشوی پوست حساس'}
]);
if(!fs.existsSync(fPlans)) writeJSON(fPlans, []);
if(!fs.existsSync(fVisits)) writeJSON(fVisits, []);
if(!fs.existsSync(fOps)) writeJSON(fOps, []);

// HTML قالب‌ها (تم سفید + نارنجی/بنفش ملایم + کمی انیمیشن)
const baseCSS = `
:root{
  --bg:#ffffff; --text:#222;
  --pri:#f39c12; /* نارنجی پاستلی */
  --sec:#a78bfa; /* بنفش پاستلی */
  --mut:#f6f7fb;
  --card:#fff; --bd:#eee;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font-family:IRANSans,Segoe UI,system-ui,-apple-system,sans-serif}
.container{max-width:1100px;margin:24px auto;padding:0 16px}
.card{background:var(--card);border:1px solid var(--bd);border-radius:14px;padding:18px;margin:14px 0;box-shadow:0 8px 22px rgba(0,0,0,.03); transition:transform .2s}
.card:hover{transform:translateY(-1px)}
h1,h2,h3{margin:8px 0 12px}
h1{font-size:20px}
.row{display:flex;gap:10px;flex-wrap:wrap}
.input,select,button,textarea{padding:10px 12px;border:1px solid var(--bd);border-radius:12px;background:#fff}
button{cursor:pointer;border:none;background:linear-gradient(135deg,var(--pri),var(--sec));color:#fff;font-weight:600;box-shadow:0 6px 14px rgba(167,139,250,.25); transition:filter .2s}
button:hover{filter:brightness(.97)}
.badge{display:inline-block; padding:6px 10px; border-radius:999px; background:var(--mut);}
.table{width:100%;border-collapse:collapse}
.table th,.table td{border-bottom:1px solid var(--bd);padding:8px;text-align:right}
.k{color:#666;font-size:12px}
.sub{font-size:12px;color:#777}
.hr{height:1px;background:var(--bd);margin:10px 0}
.fade{animation:fade .35s ease}
@keyframes fade{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
`;

const offlineJS = `
const QKEY='medrep_queue_v1';
function uuid(){return self.crypto?.randomUUID?.()||(Date.now()+'-'+Math.random());}
function loadQ(){try{return JSON.parse(localStorage.getItem(QKEY)||'[]')}catch(e){return[]}}
function saveQ(q){localStorage.setItem(QKEY,JSON.stringify(q))}
async function sendOrQueue(url,data){
  const payload=Object.assign({op_id:uuid(),ts:Date.now()},data||{});
  try{
    const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    if(!r.ok) throw 0; return await r.json();
  }catch(e){
    const q=loadQ(); q.push({url,payload}); saveQ(q);
    toast('آفلاین ذخیره شد، بعداً ارسال می‌شود.');
    return {queued:true}
  }
}
async function flushQueue(){
  const q=loadQ(); if(!q.length||!navigator.onLine) return;
  const rest=[];
  for(const it of q){
    try{
      const r=await fetch(it.url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(it.payload)});
      if(!r.ok) throw 0;
    }catch(e){ rest.push(it) }
  }
  saveQ(rest); if(rest.length===0) toast('همهٔ عملیات‌های معوقه سینک شد.');
}
window.addEventListener('online',flushQueue);
window.addEventListener('load',flushQueue);

// UI helper
function toast(msg){
  let el=document.createElement('div');
  el.textContent=msg; el.style.cssText='position:fixed;bottom:18px;left:50%;transform:translateX(-50%);background:#111;color:#fff;padding:10px 14px;border-radius:10px;opacity:.92;z-index:9999';
  document.body.appendChild(el); setTimeout(()=>el.remove(),2200);
}
`;

// صفحات
const loginAdmin = (msg='')=>`
<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8">
<title>ورود مدیر</title><style>${baseCSS}</style>
<div class="container fade">
  <h1>ورود مدیر</h1>
  ${msg?`<div class="badge" style="background:#ffe6e6"> ${msg} </div>`:''}
  <div class="card">
    <div class="row">
      <input id="u" class="input" placeholder="نام کاربری (مثلاً: admin)">
      <input id="p" class="input" type="password" placeholder="رمز">
      <button onclick="go()">ورود</button>
    </div>
    <div class="sub">پیش‌فرض: admin / admin</div>
  </div>
</div>
<script>
async function go(){
  const body={username:u.value, password:p.value};
  const r = await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(r.ok){ location.href='/admin'; } else { location.href='/login-admin?e=1'; }
}
</script>
`;

const loginRep = (msg='')=>`
<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8">
<title>ورود مدرپ</title><style>${baseCSS}</style>
<div class="container fade">
  <h1>ورود اعضا</h1>
  ${msg?`<div class="badge" style="background:#ffe6e6"> ${msg} </div>`:''}
  <div class="card">
    <div class="row">
      <input id="u" class="input" placeholder="نام کاربری">
      <input id="p" class="input" type="password" placeholder="رمز">
      <button onclick="go()">ورود</button>
    </div>
  </div>
  <div class="card">
    <h3>ثبت‌نام سریع</h3>
    <div class="row">
      <input id="su" class="input" placeholder="نام کاربری جدید">
      <select id="sr" class="input">
        <option value="rep">مدرپ</option>
        <option value="pharma">مشاور داروخانه</option>
      </select>
      <input id="sp" class="input" type="password" placeholder="رمز">
      <button onclick="signup()">ثبت</button>
    </div>
  </div>
</div>
<script>
async function go(){
  const body={username:u.value, password:p.value};
  const r = await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(r.ok){ location.href='/rep'; } else { location.href='/login?e=1'; }
}
async function signup(){
  const body={username:su.value, password:sp.value, role:sr.value};
  const r = await fetch('/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(r.ok){ alert('کاربر ایجاد شد. حالا لاگین کنید.'); } else { alert('خطا در ثبت‌نام'); }
}
</script>
`;

const adminPage = ()=>{
  const users = readJSON(fUsers,[]);
  const products = readJSON(fProducts,[]);
  return `<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8">
  <title>پنل مدیر</title><style>${baseCSS}</style>
  <div class="container fade">
    <h1>پنل مدیر</h1>

    <div class="card">
      <h3>محصولات/برند</h3>
      <div class="row">
        <input id="brand" class="input" placeholder="برند (مثلاً: اورموس)">
        <input id="name" class="input" placeholder="نام محصول">
        <button onclick="addProd()">افزودن/ویرایش</button>
      </div>
      <div class="hr"></div>
      <table class="table"><thead><tr><th>برند</th><th>نام</th><th>حذف</th></tr></thead><tbody id="pt">
        ${products.map(p=>`<tr><td>${p.brand}</td><td>${p.name}</td><td><button onclick="delProd(${p.id})">x</button></td></tr>`).join('')}
      </tbody></table>
    </div>

    <div class="card">
      <h3>کاربران</h3>
      <div class="row">
        <input id="un" class="input" placeholder="نام کاربری">
        <select id="ur" class="input"><option value="rep">مدرپ</option><option value="pharma">مشاور داروخانه</option></select>
        <input id="up" class="input" type="password" placeholder="رمز (اختیاری برای تغییر)">
        <button onclick="upsertUser()">ایجاد/به‌روزرسانی</button>
      </div>
      <div class="hr"></div>
      <table class="table"><thead><tr><th>نام</th><th>نقش</th><th>حذف</th></tr></thead><tbody id="ut">
        ${users.map(u=>`<tr><td>${u.username}</td><td>${u.role}</td><td>${u.role==='admin'?'—':`<button onclick="delUser(${u.id})">x</button>`}</td></tr>`).join('')}
      </tbody></table>
    </div>

    <div class="card">
      <h3>برنامه هفتگی (شنبه تا پنج‌شنبه)</h3>
      <div class="row">
        <select id="who" class="input">
          <option value="">— انتخاب کاربر —</option>
          ${users.filter(u=>u.role!=='admin').map(u=>`<option value="${u.id}">${u.username} (${u.role==='rep'?'مدرپ':'مشاور'})</option>`).join('')}
        </select>
        <select id="jy" class="input"></select>
        <select id="jm" class="input"></select>
        <select id="jd" class="input"></select>
        <button onclick="loadPlan()">Load</button>
        <button onclick="savePlan()">Save (Upsert)</button>
      </div>
      <div class="k">تاریخ ابتدا: روز شنبهٔ هفته (تقویم شمسی، انتخابی از سال/ماه/روز)</div>
      <div id="weekArea"></div>
    </div>

    <div class="sub">خروج: <a href="/logout">Log out</a></div>
  </div>

<script>${offlineJS}

// تاریخ شمسی ساده (تقریب – برای انتخاب؛ ذخیره همان عدد yyyy/mm/dd)
const jYears = Array.from({length: 20}, (_,i)=>1400+i);
const jMonths = Array.from({length:12},(_,i)=>i+1);
const jDays = Array.from({length:29},(_,i)=>i+1); // برای سادگی 29؛ کاربر روز شنبه را انتخاب می‌کند

function fillJ(){
  jy.innerHTML = jYears.map(y=>\`<option>\${y}</option>\`).join('');
  jm.innerHTML = jMonths.map(m=>\`<option>\${m}</option>\`).join('');
  jd.innerHTML = jDays.map(d=>\`<option>\${d}</option>\`).join('');
}
fillJ();

function weekUI(items){
  const prods = ${JSON.stringify(readJSON(fProducts,[]))};
  const brands = [...new Set(prods.map(p=>p.brand))];
  const byBrand = brand => prods.filter(p=>p.brand===brand);

  const dayNames=['شنبه','یکشنبه','دوشنبه','سه‌شنبه','چهارشنبه','پنجشنبه'];
  let html='';
  for(let day=0; day<6; day++){
    html+=\`<div class="card"><b>\${dayNames[day]}</b><div class="hr"></div>\`;
    for(let i=0;i<10;i++){
      const it = items?.[day]?.[i] || {brand:'', product:'' , target:'' , note:''};
      html+=\`
      <div class="row" style="align-items:center">
        <select class="input brand">
          <option value="">برند</option>
          \${brands.map(b=>\`<option \${it.brand===b?'selected':''}>\${b}</option>\`).join('')}
        </select>
        <select class="input product">
          <option value="">محصول</option>
          \${(it.brand?byBrand(it.brand):[]).map(p=>\`<option \${p.name===it.product?'selected':''}>\${p.name}</option>\`).join('')}
        </select>
        <input class="input target" placeholder="\${(document.getElementById('who')?.value && document.getElementById('who').selectedOptions[0].text.includes('مشاور'))?'نام داروخانه':'نام پزشک/مرکز'}" value="\${it.target||''}">
        <input class="input note" placeholder="توضیحات" value="\${it.note||''}" style="flex:1">
      </div>\`;
    }
    html+='</div>';
  }
  weekArea.innerHTML=html;
  // تغییر پویا محصولات بر اساس برند
  weekArea.querySelectorAll('select.brand').forEach((bSel)=>{
    bSel.addEventListener('change',()=>{
      const brand=bSel.value; const prodSel=bSel.parentElement.querySelector('select.product');
      const list = prods.filter(p=>p.brand===brand);
      prodSel.innerHTML = '<option value="">محصول</option>'+list.map(p=>\`<option>\${p.name}</option>\`).join('');
    });
  });
}

async function loadPlan(){
  const user_id=Number(who.value||0);
  const week_start=\`\${jy.value}/\${jm.value}/\${jd.value}\`;
  if(!user_id || !jy.value || !jm.value || !jd.value){ toast('کاربر و تاریخ را انتخاب کنید'); return; }
  const q = new URLSearchParams({user_id, week_start});
  const r = await fetch('/api/plan?'+q); const plan = r.ok? await r.json():null;
  weekUI(plan?.items||[]);
}

async function savePlan(){
  const user_id=Number(who.value||0);
  const week_start=\`\${jy.value}/\${jm.value}/\${jd.value}\`;
  if(!user_id || !jy.value || !jm.value || !jd.value){ toast('کاربر و تاریخ را انتخاب کنید'); return; }
  // جمع‌آوری 6 روز × 10 خط
  const days=[...weekArea.querySelectorAll('.card')];
  const items=days.map(dayCard=>{
    const rows = dayCard.querySelectorAll('.row');
    const arr=[];
    rows.forEach(r=>{
      const brand=r.querySelector('.brand')?.value||'';
      const product=r.querySelector('.product')?.value||'';
      const target=r.querySelector('.target')?.value||'';
      const note=r.querySelector('.note')?.value||'';
      if(brand||product||target||note) arr.push({brand,product,target,note});
    });
    return arr;
  });
  const res = await sendOrQueue('/api/plans',{user_id,week_start,items});
  if(!res.queued) toast('ذخیره شد');
}

async function addProd(){
  const brandVal=brand.value.trim(), nameVal=name.value.trim();
  if(!brandVal||!nameVal){ toast('برند و نام محصول را پر کنید'); return; }
  const r = await fetch('/api/products',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({brand:brandVal,name:nameVal})});
  if(r.ok) location.reload(); else toast('خطا در ذخیره محصول');
}
async function delProd(id){
  if(!confirm('حذف شود؟')) return;
  const r = await fetch('/api/products?id='+id,{method:'DELETE'}); if(r.ok) location.reload();
}
async function upsertUser(){
  const username=un.value.trim(), role=ur.value, password=up.value.trim();
  if(!username) return toast('نام کاربری؟');
  const r = await fetch('/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,role,password})});
  if(r.ok) location.reload(); else toast('خطا در کاربر');
}
async function delUser(id){
  if(!confirm('حذف شود؟')) return;
  const r = await fetch('/api/users?id='+id,{method:'DELETE'}); if(r.ok) location.reload();
}
</script>`;
};

const repPage = (me)=>{
  const prods = readJSON(fProducts,[]);
  const brands = [...new Set(prods.map(p=>p.brand))];
  return `<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8">
  <title>پنل ${me.role==='pharma'?'مشاور داروخانه':'مدرپ'}</title><style>${baseCSS}</style>
  <div class="container fade">
    <h1>سلام ${me.username}</h1>
    <div class="card">
      <h3>ثبت ویزیت لحظه‌ای</h3>
      <div class="row">
        <select id="b" class="input">
          <option value="">برند</option>
          ${brands.map(b=>`<option>${b}</option>`).join('')}
        </select>
        <select id="p" class="input"><option value="">محصول</option></select>
        <input id="t" class="input" placeholder="${me.role==='pharma'?'نام داروخانه':'نام پزشک/مرکز'}">
        <input id="n" class="input" placeholder="توضیحات">
        <button onclick="saveVisit()">ثبت</button>
      </div>
      <div class="k">این عملیات آفلاین هم ذخیره می‌شود و بعداً خودکار ارسال می‌شود.</div>
    </div>

    <div class="card">
      <h3>ویزیت‌های اخیر شما</h3>
      <div id="list"></div>
    </div>

    <div class="sub">خروج: <a href="/logout">Log out</a></div>
  </div>

<script>${offlineJS}
const allProds=${JSON.stringify(prods)};
b.addEventListener('change',()=>{
  const list = allProds.filter(x=>x.brand===b.value);
  p.innerHTML='<option value="">محصول</option>'+list.map(x=>\`<option>\${x.name}</option>\`).join('');
});
async function saveVisit(){
  const body={brand:b.value, product:p.value, target:t.value, note:n.value};
  if(!body.brand||!body.product||!body.target){ return toast('فیلدها را کامل کنید'); }
  const r = await sendOrQueue('/api/visits', body);
  if(!r.queued){ toast('ثبت شد'); load(); } else { toast('آفلاین ذخیره شد'); }
}
async function load(){
  const r=await fetch('/api/my-visits'); const arr=r.ok?await r.json():[];
  list.innerHTML = '<div class="k">'+(arr.slice(-20).reverse().map(v=>\`• \${v.brand} / \${v.product} → \${v.target} <span class=sub>(\${new Date(v.ts).toLocaleString('fa-IR')})</span>\`).join('<br>'))+'</div>';
}
load();
</script>`;
};

// API و مسیرها
function handleAPI(req,res,me){
  const {pathname, searchParams}=new url.URL(req.url, 'http://x');
  const p=pathname;

  // USERS
  if(p==='/api/login' && req.method==='POST'){
    return parseBody(req).then(({username,password})=>{
      const users=readJSON(fUsers,[]);
      const u=users.find(x=>x.username===username && x.passhash===hash(password||''));
      if(!u) return send(res,401,{error:'BAD'});
      const token = sign({id:u.id,username:u.username,role:u.role,ts:Date.now()});
      res.writeHead(200, {'Set-Cookie':`t=${token}; HttpOnly; Path=/`,'Content-Type':'application/json'});
      return res.end(JSON.stringify({ok:true}));
    });
  }
  if(p==='/logout'){ res.writeHead(302,{'Set-Cookie':'t=; Max-Age=0; Path=/','Location':'/login'}); return res.end(); }

  if(p==='/api/users' && req.method==='POST'){
    if(me.role!=='admin') return send(res,403,{error:'FORBIDDEN'});
    return parseBody(req).then(({username,password,role})=>{
      if(!username||!role) return send(res,400,{error:'MISSING'});
      const users=readJSON(fUsers,[]);
      let u=users.find(x=>x.username===username);
      if(u){ if(password) u.passhash=hash(password); u.role=role; }
      else{ const id=(users.at(-1)?.id||0)+1; u={id,username,role,passhash:hash(password||'1234')}; users.push(u); }
      writeJSON(fUsers,users); send(res,200,{ok:true});
    });
  }
  if(p==='/api/users' && req.method==='DELETE'){
    if(me.role!=='admin') return send(res,403,{error:'FORBIDDEN'});
    const id=Number((searchParams.get('id')||0));
    const users=readJSON(fUsers,[]).filter(u=>u.id!==id || u.role==='admin');
    writeJSON(fUsers,users); return send(res,200,{ok:true});
  }

  // PRODUCTS
  if(p==='/api/products' && req.method==='GET'){
    return send(res,200,readJSON(fProducts,[]));
  }
  if(p==='/api/products' && req.method==='POST'){
    if(me.role!=='admin') return send(res,403,{error:'FORBIDDEN'});
    return parseBody(req).then(({brand,name})=>{
      if(!brand||!name) return send(res,400,{error:'MISSING'});
      const products=readJSON(fProducts,[]);
      let ex=products.find(p=>p.brand===brand && p.name===name);
      if(!ex){ const id=(products.at(-1)?.id||0)+1; products.push({id,brand,name}); }
      writeJSON(fProducts,products); send(res,200,{ok:true});
    });
  }
  if(p==='/api/products' && req.method==='DELETE'){
    if(me.role!=='admin') return send(res,403,{error:'FORBIDDEN'});
    const id=Number((searchParams.get('id')||0));
    const products=readJSON(fProducts,[]).filter(p=>p.id!==id);
    writeJSON(fProducts,products); return send(res,200,{ok:true});
  }

  // Idempotency helpers
  const getProcessed=()=> new Set(readJSON(fOps,[]));
  const addProcessed=(set,id)=>{ const arr=Array.from(set); arr.push(id); writeJSON(fOps,arr); };

  // PLANS (هفتگی)
  if(p==='/api/plans' && req.method==='POST'){
    if(me.role!=='admin') return send(res,403,{error:'FORBIDDEN'});
    return parseBody(req).then(({op_id,user_id,week_start,items})=>{
      if(!op_id||!user_id||!week_start) return send(res,400,{error:'MISSING'});
      const processed=getProcessed(); if(processed.has(op_id)) return send(res,200,{ok:true,dedup:true});
      const plans=readJSON(fPlans,[]);
      const idx=plans.findIndex(pl=>pl.user_id===user_id && pl.week_start===week_start);
      const rec={id: idx>=0? plans[idx].id : (plans.at(-1)?.id||0)+1, user_id, week_start, items:Array.isArray(items)?items:[]};
      if(idx>=0) plans[idx]=rec; else plans.push(rec);
      writeJSON(fPlans,plans);
      processed.add(op_id); addProcessed(processed,op_id);
      return send(res,200,{ok:true});
    });
  }
  if(p==='/api/plan' && req.method==='GET'){
    const user_id=Number(searchParams.get('user_id')||0);
    const week_start=searchParams.get('week_start')||'';
    const plans=readJSON(fPlans,[]);
    const plan=plans.find(pl=>pl.user_id===user_id && pl.week_start===week_start)||null;
    return send(res,200,plan);
  }

  // VISITS
  if(p==='/api/visits' && req.method==='POST'){
    if(!me||!me.id) return send(res,401,{error:'AUTH'});
    return parseBody(req).then(({op_id,brand,product,target,note})=>{
      if(!op_id||!brand||!product||!target) return send(res,400,{error:'MISSING'});
      const processed=getProcessed(); if(processed.has(op_id)) return send(res,200,{ok:true,dedup:true});
      const visits=readJSON(fVisits,[]);
      const id=(visits.at(-1)?.id||0)+1;
      visits.push({id,user_id:me.id,brand,product,target,note:note||'',ts:Date.now()});
      writeJSON(fVisits,visits);
      processed.add(op_id); addProcessed(processed,op_id);
      return send(res,200,{ok:true});
    });
  }
  if(p==='/api/my-visits' && req.method==='GET'){
    if(!me||!me.id) return send(res,401,{error:'AUTH'});
    const visits=readJSON(fVisits,[]).filter(v=>v.user_id===me.id);
    return send(res,200,visits);
  }

  return send(res,404,{error:'NOT_FOUND'});
}

// Router
function router(req,res){
  const cookies = cookieParse(req.headers.cookie||'');
  const me = verify(cookies.t)||{};
  const u = new url.URL(req.url,'http://x');

  if(u.pathname.startsWith('/api/')) return handleAPI(req,res,me);

  if(u.pathname==='/login-admin') return serve(res, loginAdmin(u.searchParams.get('e')?'ورود ناموفق':''));
  if(u.pathname==='/login') return serve(res, loginRep(u.searchParams.get('e')?'ورود ناموفق':''));

  if(u.pathname==='/admin'){ if(me.role!=='admin') return res.writeHead(302,{Location:'/login-admin'}).end(); return serve(res, adminPage()); }
  if(u.pathname==='/rep'){ if(!me.id) return res.writeHead(302,{Location:'/login'}).end(); return serve(res, repPage(me)); }

  if(u.pathname==='/') return res.writeHead(302,{Location:'/login'}).end();

  // استاتیک بسیار ساده (لوگو و…)
  if(u.pathname.startsWith('/uploads/')){
    const fp=path.join(ROOT,u.pathname);
    if(fs.existsSync(fp)) { res.writeHead(200,{'Content-Type':'application/octet-stream'}); return fs.createReadStream(fp).pipe(res); }
  }

  return send(res,404,{error:'NOT_FOUND'});
}

// ---- server listen (پورت ثابت؛ بدون پرش به پورت بعدی)
const PORT = parseInt(process.env.PORT||'8080',10);
const server = http.createServer(router);
server.listen(PORT,'0.0.0.0',()=>console.log(`Server listening on http://localhost:${PORT}`));
server.on('error',(err)=>{
  if(err.code==='EADDRINUSE'){
    console.error(`Port ${PORT} is busy. با Ctrl+C سرور قبلی را ببند یا PORT دیگری بده (مثلاً: set PORT=8081).`);
  } else console.error(err);
  process.exit(1);
});
