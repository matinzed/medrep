/**
 * mrp-onefile.js (نسخه‌ی تک‌فایلی به‌روزشده)
 * — سفید، نارنجی/بنفش پاستلی، تاریخ شمسی، برند/محصول، نقش «مشاور داروخانه»، روزها از شنبه، SSE
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const PORT = 8080;
const ROOT = __dirname;
const DATA_DIR = ROOT;
const UPLOAD_DIR = path.join(ROOT, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ---------- mini JSON DB ----------
const fUsers = path.join(DATA_DIR, 'users.json');
const fProducts = path.join(DATA_DIR, 'products.json');
const fPlans = path.join(DATA_DIR, 'plans.json');
const fVisits = path.join(DATA_DIR, 'visits.json');

function readJSON(fp, def) { try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { return def; } }
function writeJSON(fp, obj) { fs.writeFileSync(fp, JSON.stringify(obj, null, 2), 'utf8'); }

if (!fs.existsSync(fUsers)) {
  writeJSON(fUsers, [{ id: 1, name: 'مدیر سیستم', username: 'admin', pass: hash('admin'), role: 'admin' }]);
}
if (!fs.existsSync(fProducts)) writeJSON(fProducts, []); // {id,name,brand,image}
if (!fs.existsSync(fPlans)) writeJSON(fPlans, []);       // {id,user_id,week_start,items:[{day_index,doctor,details,product_id}]}
if (!fs.existsSync(fVisits)) writeJSON(fVisits, []);     // {id,user_id,date,doctor,product_id,note}

function hash(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function newId(list) { return (list.reduce((m, x) => Math.max(m, x.id || 0), 0) + 1) || 1; }

// ---------- sessions ----------
const sessions = new Map(); // token -> {id,role,name}
function makeToken(u) { const t = crypto.randomBytes(24).toString('hex'); sessions.set(t, { id: u.id, role: u.role, name: u.name }); return t; }
function getUserFromReq(req) {
  const hdr = req.headers['authorization'] || '';
  const m = hdr.match(/^Bearer (.+)$/);
  const t = m ? m[1] : null;
  if (!t) return null;
  return sessions.get(t) || null;
}

// ---------- SSE (live feed) ----------
const sseClients = new Set();
function sseBroadcast(payload) {
  const msg = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of sseClients) { try { res.write(msg); } catch (_e) {} }
}

// ---------- helpers ----------
function send(res, code, body, headers = {}) {
  const h = Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, headers);
  res.writeHead(code, h);
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}
function notFound(res) { send(res, 404, { error: 'NOT_FOUND' }); }
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; if (data.length > 20 * 1024 * 1024) req.destroy(); });
    req.on('end', () => { if (!data) return resolve({}); try { resolve(JSON.parse(data)); } catch { resolve({}); } });
    req.on('error', reject);
  });
}
function serveText(res, html) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); }
function serveFile(res, filePath, ctype = 'text/plain') {
  if (!fs.existsSync(filePath)) return notFound(res);
  res.writeHead(200, { 'Content-Type': ctype });
  fs.createReadStream(filePath).pipe(res);
}

// ---------- theme ----------
const css = `
:root{--bg:#ffffff;--panel:#ffffff;--muted:#f5f7fb;--text:#111827;--accent:#a78bfa;--accent2:#f59e0b;--border:#e5e7eb}
*{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--text);font-family:IRANSans,system-ui,Segoe UI,Roboto}
.container{max-width:1100px;margin:auto;padding:16px;direction:rtl}
.card{background:var(--panel);border:1px solid var(--border);border-radius:14px;padding:16px;box-shadow:0 6px 18px #0000000c;margin-top:12px}
.header{display:flex;justify-content:space-between;align-items:center}
a{color:#6d28d9;text-decoration:none}
.row{display:flex;gap:12px;flex-wrap:wrap}.col{flex:1 1 260px}
.input,select,textarea{width:100%;padding:10px;border-radius:10px;border:1px solid var(--border);background:#fff;color:var(--text)}
textarea{min-height:110px}
.btn{border:0;border-radius:10px;padding:10px 14px;cursor:pointer}
.btn.primary{background:linear-gradient(90deg,var(--accent),var(--accent2));color:#fff}
.btn.ok{background:#10b981;color:#fff}
.table{width:100%;border-collapse:collapse}
.table th,.table td{border-bottom:1px solid var(--border);padding:8px;text-align:right}
.badge{display:inline-block;padding:3px 8px;border-radius:999px;background:#f3f4f6;border:1px solid var(--border)}
.thumb{width:48px;height:48px;object-fit:cover;border-radius:8px;border:1px solid var(--border)}
.live{background:#fff7ed;border-color:#fed7aa}
`;

// ---------- common JS ----------
const commonJS = `
function saveToken(t){ localStorage.setItem('token', t); }
function getToken(){ return localStorage.getItem('token'); }
async function api(p,options={}){
  const headers = Object.assign({'Content-Type':'application/json'}, options.headers||{});
  const t = getToken(); if (t) headers['Authorization']='Bearer '+t;
  const r = await fetch(p,{...options,headers}); if(!r.ok){const j=await r.json().catch(()=>({}));throw new Error(j.error||'ERR');}
  if(r.status===204) return null; return r.json();
}
`;

// ---------- pages ----------
const loginAdmin = (`
<!doctype html><meta charset="utf-8"/><title>ورود مدیر</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/persian-datepicker@1.2.0/dist/css/persian-datepicker.min.css">
<style>${css}</style>
<div class="container">
  <div class="card">
    <div class="header"><h2>ورود مدیر</h2><a href="/login">ورود مدرپ / مشاور</a></div>
    <div class="row">
      <div class="col"><input id="u" class="input" placeholder="نام کاربری"></div>
      <div class="col"><input id="p" class="input" type="password" placeholder="رمز عبور"></div>
      <div class="col" style="align-self:flex-end"><button class="btn primary" id="b">ورود</button></div>
    </div>
    <div id="e" style="color:#ef4444;margin-top:8px"></div>
  </div>
</div>
<script>${commonJS}
document.getElementById('b').onclick = async ()=>{
  const username=document.getElementById('u').value.trim();
  const password=document.getElementById('p').value;
  try{const {token,user}=await api('/api/login',{method:'POST',body:JSON.stringify({username,password})});
    if(user.role!=='admin') throw new Error('دسترسی مدیر نیست'); saveToken(token); location.href='/admin';
  }catch(e){document.getElementById('e').textContent=e.message;}
};
</script>`);

const loginRep = (`
<!doctype html><meta charset="utf-8"/><title>ورود کاربر</title>
<style>${css}</style>
<div class="container">
  <div class="card">
    <div class="header"><h2>ورود مدرپ / مشاور داروخانه</h2><a href="/signup">ثبت‌نام</a> | <a href="/login-admin">ورود مدیر</a></div>
    <div class="row">
      <div class="col"><input id="u" class="input" placeholder="نام کاربری"></div>
      <div class="col"><input id="p" class="input" type="password" placeholder="رمز عبور"></div>
      <div class="col" style="align-self:flex-end"><button class="btn primary" id="b">ورود</button></div>
    </div><div id="e" style="color:#ef4444;margin-top:8px"></div>
  </div>
</div>
<script>${commonJS}
document.getElementById('b').onclick = async ()=>{
  const username=document.getElementById('u').value.trim();
  const password=document.getElementById('p').value;
  try{const {token,user}=await api('/api/login',{method:'POST',body:JSON.stringify({username,password})});
    if(user.role==='admin') throw new Error('از صفحهٔ مدیر استفاده کن'); saveToken(token); location.href='/rep';
  }catch(e){document.getElementById('e').textContent=e.message;}
};
</script>`);

const signupRep = (`
<!doctype html><meta charset="utf-8"/><title>ثبت‌نام</title>
<style>${css}</style>
<div class="container"><div class="card">
  <div class="header"><h2>ثبت‌نام کاربر</h2><a href="/login">ورود</a></div>
  <div class="row">
    <div class="col"><input id="n" class="input" placeholder="نام و نام‌خانوادگی"></div>
    <div class="col"><input id="u" class="input" placeholder="نام کاربری"></div>
    <div class="col"><input id="p" class="input" type="password" placeholder="رمز عبور"></div>
    <div class="col"><select id="r" class="input">
      <option value="rep">مدرپ</option>
      <option value="advisor">مشاور داروخانه</option>
    </select></div>
    <div class="col" style="align-self:flex-end"><button class="btn primary" id="b">ثبت‌نام</button></div>
  </div><div id="e" style="color:#ef4444;margin-top:8px"></div>
</div></div>
<script>${commonJS}
document.getElementById('b').onclick = async ()=>{
  const name=document.getElementById('n').value.trim();
  const username=document.getElementById('u').value.trim();
  const password=document.getElementById('p').value;
  const role=document.getElementById('r').value;
  try{const {token}=await api('/api/register',{method:'POST',body:JSON.stringify({name,username,password,role})});
    saveToken(token); location.href='/rep';
  }catch(e){document.getElementById('e').textContent=e.message;}
};
</script>`);

const adminPage = (`
<!doctype html><meta charset="utf-8"/><title>داشبورد مدیر</title>
<style>${css}</style>
<div class="container">
  <div class="header"><h2>داشبورد مدیر</h2><div><a href="/admin">صفحه اصلی</a> | <a href="/admin-reports">گزارش زنده</a> | <a href="/login-admin" onclick="localStorage.clear()">خروج</a></div></div>

  <div class="card">
    <h3>📦 محصولات</h3>
    <div class="row">
      <div class="col"><input id="pn" class="input" placeholder="نام محصول"></div>
      <div class="col"><input id="pb" class="input" placeholder="برند"></div>
      <div class="col"><input id="pi" class="input" type="file" accept="image/*"></div>
      <div class="col" style="align-self:flex-end"><button class="btn ok" id="ps">ذخیره</button></div>
    </div>
    <table class="table" id="pt"></table>
  </div>

  <div class="card">
    <h3>👥 کاربران</h3>
    <div class="row">
      <div class="col"><input id="un" class="input" placeholder="نام"></div>
      <div class="col"><input id="uu" class="input" placeholder="نام کاربری"></div>
      <div class="col"><input id="up" class="input" placeholder="رمز"></div>
      <div class="col"><select id="ur" class="input"><option value="rep">مدرپ</option><option value="advisor">مشاور داروخانه</option></select></div>
      <div class="col" style="align-self:flex-end"><button class="btn ok" id="us">ایجاد کاربر</button></div>
    </div>
    <table class="table" id="ut"></table>
  </div>

  <div class="card">
    <h3>🗓️ برنامه هفتگی</h3>
    <div class="row">
      <div class="col"><select id="user" class="input"></select></div>
      <div class="col"><input id="week" class="input pdate" placeholder="انتخاب هفته (شمسی)"></div>
    </div>
    <table class="table" id="wb"></table>
    <div style="margin-top:8px"><button class="btn primary" id="ws">ذخیره برنامه</button></div>
  </div>

  <div class="card live">
    <h3>🔔 ویزیت‌های لحظه‌ای (Live)</h3>
    <div id="live"></div>
  </div>
</div>

<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/persian-datepicker@1.2.0/dist/css/persian-datepicker.min.css">
<script src="https://cdn.jsdelivr.net/npm/jquery@3.7.1/dist/jquery.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/persian-date@1.1.0/dist/persian-date.js"></script>
<script src="https://cdn.jsdelivr.net/npm/persian-datepicker@1.2.0/dist/js/persian-datepicker.min.js"></script>

<script>${commonJS}
const days=['شنبه','یکشنبه','دوشنبه','سه‌شنبه','چهارشنبه','پنجشنبه','جمعه'];
function toBase64(file){return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(String(r.result).split(',')[1]);r.onerror=rej;r.readAsDataURL(file);});}

async function loadProducts(){
  const j=await api('/api/products');
  document.getElementById('pt').innerHTML='<tr><th>عکس</th><th>نام</th><th>برند</th></tr>'+
    j.map(p=>\`<tr><td>\${p.image?'<img class="thumb" src="'+p.image+'">':''}</td><td>\${p.name}</td><td><span class="badge">\${p.brand||'-'}</span></td></tr>\`).join('');
}
async function loadUsers(){
  const u=await api('/api/users');
  document.getElementById('ut').innerHTML='<tr><th>نام</th><th>نام کاربری</th><th>نقش</th></tr>'+
    u.filter(x=>x.role!=='admin').map(x=>\`<tr><td>\${x.name}</td><td>\${x.username}</td><td>\${x.role==='rep'?'مدرپ':'مشاور'}</td></tr>\`).join('');
  document.getElementById('user').innerHTML=
    u.filter(x=>x.role!=='admin').map(x=>\`<option value="\${x.id}">\${x.name} — \${x.role==='rep'?'مدرپ':'مشاور'}</option>\`).join('');
}
function renderWeek(){
  const wb=document.getElementById('wb');wb.innerHTML='';
  for(let i=0;i<7;i++){
    const tr=document.createElement('tr');
    tr.innerHTML=\`<td>\${days[i]}</td>
      <td><input class="input d" data-i="\${i}" placeholder="نام پزشک / مرکز"></td>
      <td><textarea class="input t" data-i="\${i}" placeholder="توضیحات"></textarea></td>
      <td><input class="input p" data-i="\${i}" placeholder="ID محصول (اختیاری)"></td>\`;
    wb.appendChild(tr);
  }
}
document.getElementById('ps').onclick=async()=>{
  const name=document.getElementById('pn').value.trim();
  const brand=document.getElementById('pb').value.trim();
  let image='';
  const f=document.getElementById('pi').files[0];
  if(f){const b64=await toBase64(f);const j=await api('/api/upload-image',{method:'POST',body:JSON.stringify({base64:b64,ext:f.name.split('.').pop()})});image=j.url;}
  await api('/api/products',{method:'POST',body:JSON.stringify({name,brand,image})});
  document.getElementById('pn').value='';document.getElementById('pb').value='';document.getElementById('pi').value=null;loadProducts();
};
document.getElementById('us').onclick=async()=>{
  const name=document.getElementById('un').value.trim();
  const username=document.getElementById('uu').value.trim();
  const password=document.getElementById('up').value;
  const role=document.getElementById('ur').value;
  await api('/api/users',{method:'POST',body:JSON.stringify({name,username,password,role})});
  document.getElementById('un').value='';document.getElementById('uu').value='';document.getElementById('up').value='';loadUsers();
};
document.getElementById('ws').onclick=async()=>{
  const user_id=Number(document.getElementById('user').value);
  const ws = window._selectedWeekStart; // از Datepicker می‌آید
  const it=[];
  document.querySelectorAll('.d').forEach(x=>{
    const i=+x.dataset.i;const d=x.value.trim();
    const t=document.querySelector('.t[data-i="'+i+'"]').value.trim();
    const p=document.querySelector('.p[data-i="'+i+'"]').value.trim();
    if(d) it.push({day_index:i,doctor:d,details:t,product_id:p?Number(p):null});
  });
  if(!ws){alert('هفته را انتخاب کنید (شمسی)');return;}
  await api('/api/plans',{method:'POST',body:JSON.stringify({user_id,week_start:ws,items:it})});
  alert('ذخیره شد');
};
renderWeek(); loadProducts(); loadUsers();

// تاریخ‌نگار هفته (شمسی)
$(function(){
  const $week = $('#week');
  $week.pDatepicker({
    format: 'YYYY-MM-DD',
    initialValue: false,
    autoClose: true,
    onSelect: function(unix){
      const d = new persianDate(unix).toCalendar('gregorian'); // تاریخ جلالی → میلادی
      // پیدا کردن شنبه‌ی همان هفته جلالی، سپس به میلادی برگردان برای ذخیره
      let pd = new persianDate(unix).startOf('week'); // شروع هفته (شنبه)
      const g = pd.toCalendar('gregorian');
      const ws = new Date(g.year, g.month-1, g.day).toISOString().slice(0,10);
      window._selectedWeekStart = ws;
    }
  });
});

// Live feed via SSE
const es = new EventSource('/sse');
const live = document.getElementById('live');
es.onmessage = (ev)=> {
  const d = JSON.parse(ev.data);
  if(d.type==='visit'){ const x = d.payload;
    const el = document.createElement('div');
    el.innerHTML = '🟣 ویزیت جدید — ' + (x.user_name||'کاربر') + ' | '+ x.date + ' | ' + x.doctor + (x.product_name?(' | '+x.product_name):'');
    live.prepend(el);
  }
};
</script>`);

const adminReports = (`
<!doctype html><meta charset="utf-8"/><title>گزارش مدیر</title>
<style>${css}</style>
<div class="container">
  <div class="header"><h2>گزارش‌ها</h2><div><a href="/admin">داشبورد</a> | <a href="/login-admin" onclick="localStorage.clear()">خروج</a></div></div>
  <div class="card">
    <div class="row">
      <div class="col"><input id="from" class="input pdate" placeholder="از تاریخ (شمسی)"></div>
      <div class="col"><input id="to" class="input pdate" placeholder="تا تاریخ (شمسی)"></div>
      <div class="col"><button class="btn primary" id="run">اجرای گزارش</button></div>
    </div>
    <div id="kpi" style="margin-top:10px"></div>
    <table class="table" id="tbl"></table>
  </div>
</div>

<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/persian-datepicker@1.2.0/dist/css/persian-datepicker.min.css">
<script src="https://cdn.jsdelivr.net/npm/jquery@3.7.1/dist/jquery.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/persian-date@1.1.0/dist/persian-date.js"></script>
<script src="https://cdn.jsdelivr.net/npm/persian-datepicker@1.2.0/dist/js/persian-datepicker.min.js"></script>

<script>${commonJS}
function toG(yMd){ // 'YYYY-MM-DD' جلالی → میلادی ISO
  const p = new persianDate().parse(yMd);
  const g = new persianDate(p).toCalendar('gregorian');
  const dt = new Date(g.year, g.month-1, g.day);
  return dt.toISOString().slice(0,10);
}
function initPickers(){
  ['from','to'].forEach(id=>{
    $('#'+id).pDatepicker({
      format:'YYYY-MM-DD', initialValue:false, autoClose:true,
      onSelect: function(unix){
        const p = new persianDate(unix).toCalendar('gregorian');
        document.getElementById(id)._g = new Date(p.year, p.month-1, p.day).toISOString().slice(0,10);
      }
    });
  });
}
async function run(){
  const f=document.getElementById('from')._g || '0001-01-01';
  const t=document.getElementById('to')._g || '9999-12-31';
  const ov=await api('/api/reports/overview?from='+f+'&to='+t);
  const bp=await api('/api/reports/by-product?from='+f+'&to='+t);
  document.getElementById('kpi').innerHTML='کل ویزیت‌ها: '+ov.total+' | پزشکان یکتا: '+ov.unique;
  document.getElementById('tbl').innerHTML='<tr><th>برند</th><th>محصول</th><th>تعداد</th></tr>'+
    bp.map(r=>\`<tr><td>\${r.brand||'-'}</td><td>\${r.product}</td><td>\${r.count}</td></tr>\`).join('');
}
initPickers();
document.getElementById('run').onclick=run;
</script>`);

const repPage = (`
<!doctype html><meta charset="utf-8"/><title>داشبورد کاربر</title>
<style>${css}</style>
<div class="container">
  <div class="header"><h2>داشبورد من</h2><div><a href="/login" onclick="localStorage.clear()">خروج</a></div></div>

  <div class="card">
    <h3>🗓️ برنامه هفتگی</h3>
    <div class="row"><div class="col"><input id="week" class="input pdate" placeholder="انتخاب هفته (شمسی)"></div><div class="col"><button id="show" class="btn primary">نمایش</button></div></div>
    <table class="table" id="plan"></table>
  </div>

  <div class="card">
    <h3>🗂️ ثبت ویزیت</h3>
    <div class="row">
      <div class="col"><input id="vd" class="input pdate" placeholder="تاریخ (شمسی)"></div>
      <div class="col"><input id="vc" class="input" placeholder="نام پزشک/مرکز"></div>
      <div class="col"><select id="vb" class="input"></select></div>
      <div class="col"><select id="vp" class="input"></select></div>
    </div>
    <div class="row">
      <div class="col"><textarea id="vn" class="input" placeholder="توضیحات"></textarea></div>
      <div class="col" style="align-self:flex-end"><button id="add" class="btn ok">ثبت</button></div>
    </div>
    <table class="table" id="vis"></table>
  </div>

  <div class="card">
    <h3>📈 گزارش من</h3>
    <div class="row">
      <div class="col"><input id="rf" class="input pdate" placeholder="از (شمسی)"></div>
      <div class="col"><input id="rt" class="input pdate" placeholder="تا (شمسی)"></div>
      <div class="col"><button id="rr" class="btn primary">نمایش گزارش</button></div>
    </div>
    <div id="rk"></div>
  </div>
</div>

<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/persian-datepicker@1.2.0/dist/css/persian-datepicker.min.css">
<script src="https://cdn.jsdelivr.net/npm/jquery@3.7.1/dist/jquery.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/persian-date@1.1.0/dist/persian-date.js"></script>
<script src="https://cdn.jsdelivr.net/npm/persian-datepicker@1.2.0/dist/js/persian-datepicker.min.js"></script>

<script>${commonJS}
const days=['شنبه','یکشنبه','دوشنبه','سه‌شنبه','چهارشنبه','پنجشنبه','جمعه'];
let products=[];

function initPickers(ids){
  ids.forEach(id=>{
    $('#'+id).pDatepicker({
      format:'YYYY-MM-DD', initialValue:false, autoClose:true,
      onSelect: function(unix){
        const p = new persianDate(unix).toCalendar('gregorian');
        document.getElementById(id)._g = new Date(p.year, p.month-1, p.day).toISOString().slice(0,10);
      }
    });
  });
}
initPickers(['vd','rf','rt','week']);

async function loadProducts(){
  products = await api('/api/products');
  const brands=[...new Set(products.map(p=>p.brand||'-'))];
  vb.innerHTML = '<option value="">— برند —</option>' + brands.map(b=>\`<option>\${b}</option>\`).join('');
  vp.innerHTML = '<option value="">— محصول —</option>';
}
vb.onchange = ()=>{
  const b = vb.value;
  const list = products.filter(p=> (p.brand||'-')===b );
  vp.innerHTML = '<option value="">— محصول —</option>' + list.map(p=>\`<option value="\${p.id}">\${p.name}</option>\`).join('');
};

async function loadVisits(){
  const j=await api('/api/my/visits');
  vis.innerHTML='<tr><th>تاریخ (میلادی)</th><th>پزشک</th><th>برند</th><th>محصول</th><th>توضیح</th></tr>'+
    j.map(v=>{
      const p = products.find(x=>x.id===v.product_id);
      return \`<tr><td>\${v.date}</td><td>\${v.doctor}</td><td>\${p?.brand||'-'}</td><td>\${p?.name||'-'}</td><td>\${v.note||''}</td></tr>\`;
    }).join('');
}
add.onclick=async()=>{
  const date = vd._g; if(!date) return alert('تاریخ (شمسی) را انتخاب کنید');
  const doctor = vc.value.trim(); if(!doctor) return alert('نام پزشک/مرکز را وارد کنید');
  const product_id = vp.value ? Number(vp.value) : null;
  const note = vn.value.trim();
  await api('/api/visits',{method:'POST',body:JSON.stringify({date,doctor,product_id,note})});
  vc.value=''; vn.value='';
  loadVisits();
};
function isoWeekToSaturday(isoG){ // isoG: تاریخ میلادی شنبه‌ی هفته
  return isoG;
}
show.onclick=async()=>{
  const ws = week._g;
  if(!ws) return alert('هفته را انتخاب کن');
  const j=await api('/api/my/plan?week_start='+ws);
  if(!j){plan.innerHTML='<tr><td>برنامه‌ای ثبت نشده.</td></tr>';return;}
  plan.innerHTML='<tr><th>روز</th><th>پزشک</th><th>جزییات</th><th>محصول</th></tr>'+
    j.items.map(it=>{
      const p=products.find(x=>x.id===it.product_id);
      return \`<tr><td>\${days[it.day_index]}</td><td>\${it.doctor}</td><td>\${it.details||''}</td><td>\${p? (p.brand+' — '+p.name) : '-'}</td></tr>\`;
    }).join('');
};
rr.onclick=async()=>{
  const f=rf._g||'0001-01-01', t=rt._g||'9999-12-31';
  const j=await api('/api/my/overview?from='+f+'&to='+t); rk.innerHTML='کل ویزیت‌ها: '+j.total+' | پزشکان یکتا: '+j.unique;
};
loadProducts(); loadVisits();
</script>`);

// ---------- API ----------
function handleAPI(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  if (p === '/sse') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write('\n'); sseClients.add(res);
    req.on('close', ()=> sseClients.delete(res));
    return;
  }

  if (p === '/api/register' && req.method === 'POST') {
    return parseBody(req).then(({ name, username, password, role }) => {
      if (!name || !username || !password) return send(res, 400, { error: 'MISSING' });
      const users = readJSON(fUsers, []);
      if (users.find(u => u.username === username)) return send(res, 409, { error: 'USERNAME_TAKEN' });
      const u = { id: newId(users), name, username, pass: hash(password), role: (role==='advisor'?'advisor':'rep') };
      users.push(u); writeJSON(fUsers, users);
      const token = makeToken(u);
      send(res, 200, { token, user: { id: u.id, name: u.name, username: u.username, role: u.role } });
    });
  }
  if (p === '/api/login' && req.method === 'POST') {
    return parseBody(req).then(({ username, password }) => {
      const users = readJSON(fUsers, []);
      const u = users.find(x => x.username === username && x.pass === hash(password));
      if (!u) return send(res, 401, { error: 'INVALID_CREDENTIALS' });
      const token = makeToken(u);
      send(res, 200, { token, user: { id: u.id, name: u.name, username: u.username, role: u.role } });
    });
  }

  const me = getUserFromReq(req);
  if (!me) return send(res, 401, { error: 'NO_TOKEN' });

  if (p === '/api/users' && req.method === 'GET') {
    if (me.role !== 'admin') return send(res, 403, { error: 'FORBIDDEN' });
    return send(res, 200, readJSON(fUsers, []).map(u => ({ id: u.id, name: u.name, username: u.username, role: u.role })));
  }
  if (p === '/api/users' && req.method === 'POST') {
    if (me.role !== 'admin') return send(res, 403, { error: 'FORBIDDEN' });
    return parseBody(req).then(({ name, username, password, role }) => {
      if (!name || !username || !password) return send(res, 400, { error: 'MISSING' });
      const users = readJSON(fUsers, []);
      if (users.find(u => u.username === username)) return send(res, 409, { error: 'USERNAME_TAKEN' });
      const u = { id: newId(users), name, username, pass: hash(password), role: (role==='advisor'?'advisor':'rep') };
      users.push(u); writeJSON(fUsers, users);
      send(res, 200, { id: u.id });
    });
  }

  // products
  if (p === '/api/products' && req.method === 'GET') { return send(res, 200, readJSON(fProducts, [])); }
  if (p === '/api/products' && req.method === 'POST') {
    if (me.role !== 'admin') return send(res, 403, { error: 'FORBIDDEN' });
    return parseBody(req).then(({ name, brand, image }) => {
      if (!name) return send(res, 400, { error: 'MISSING' });
      const products = readJSON(fProducts, []);
      const prod = { id: newId(products), name, brand: brand || '', image: image || null };
      products.push(prod); writeJSON(fProducts, products);
      send(res, 200, prod);
    });
  }
  if (p === '/api/upload-image' && req.method === 'POST') {
    if (me.role !== 'admin') return send(res, 403, { error: 'FORBIDDEN' });
    return parseBody(req).then(({ base64, ext }) => {
      const fname = `p_${Date.now()}_${Math.random().toString(36).slice(2)}.${(ext || 'png').replace(/[^a-z0-9]/gi, '')}`;
      const fp = path.join(UPLOAD_DIR, fname);
      fs.writeFileSync(fp, Buffer.from(base64, 'base64'));
      send(res, 200, { url: '/uploads/' + fname });
    });
  }

  // plans
  if (p === '/api/plans' && req.method === 'POST') {
    if (me.role !== 'admin') return send(res, 403, { error: 'FORBIDDEN' });
    return parseBody(req).then(({ user_id, week_start, items }) => {
      if (!user_id || !week_start) return send(res, 400, { error: 'MISSING' });
      const plans = readJSON(fPlans, []);
      const plan = { id: newId(plans), user_id, week_start, items: Array.isArray(items) ? items : [] };
      plans.push(plan); writeJSON(fPlans, plans);
      send(res, 200, { id: plan.id, week_start: plan.week_start });
    });
  }
  if (p === '/api/my/plan' && req.method === 'GET') {
    const ws = new URL(req.url, 'http://x').searchParams.get('week_start');
    const plans = readJSON(fPlans, []);
    const plan = plans.find(pl => pl.user_id === me.id && pl.week_start === ws);
    return send(res, 200, plan || null);
  }

  // visits
  if (p === '/api/visits' && req.method === 'POST') {
    return parseBody(req).then(({ date, doctor, product_id, note }) => {
      if (!date || !doctor) return send(res, 400, { error: 'MISSING' });
      const visits = readJSON(fVisits, []);
      const v = { id: newId(visits), user_id: me.id, date, doctor, product_id: product_id || null, note: note || null };
      visits.push(v); writeJSON(fVisits, visits);

      const users = readJSON(fUsers, []);
      const user = users.find(u => u.id===me.id);
      const products = readJSON(fProducts, []);
      const prod = products.find(p=>p.id===product_id);
      sseBroadcast({ type:'visit', payload: { user_name: user?.name, date, doctor, product_name: prod? (prod.brand+' — '+prod.name):null } });

      send(res, 200, { id: v.id });
    });
  }
  if (p === '/api/my/visits' && req.method === 'GET') {
    const visits = readJSON(fVisits, []).filter(v => v.user_id === me.id).sort((a, b) => b.date.localeCompare(a.date));
    return send(res, 200, visits);
  }

  // reports
  if (p === '/api/reports/overview' && req.method === 'GET') {
    if (me.role !== 'admin') return send(res, 403, { error: 'FORBIDDEN' });
    const q = new URL(req.url, 'http://x').searchParams;
    const from = q.get('from') || '0000-01-01';
    const to = q.get('to') || '9999-12-31';
    const visits = readJSON(fVisits, []).filter(v => v.date >= from && v.date <= to);
    const total = visits.length;
    const unique = new Set(visits.map(v => v.doctor)).size;
    return send(res, 200, { total, unique });
  }
  if (p === '/api/reports/by-product' && req.method === 'GET') {
    if (me.role !== 'admin') return send(res, 403, { error: 'FORBIDDEN' });
    const q = new URL(req.url, 'http://x').searchParams;
    const from = q.get('from') || '0000-01-01';
    const to = q.get('to') || '9999-12-31';
    const visits = readJSON(fVisits, []).filter(v => v.date >= from && v.date <= to);
    const products = readJSON(fProducts, []);
    const nameOf = (id) => (products.find(p => p.id === id)?.name) || '—';
    const brandOf = (id) => (products.find(p => p.id === id)?.brand) || '';
    const map = {};
    for (const v of visits) {
      const k = nameOf(v.product_id), b = brandOf(v.product_id);
      const key = b+'__'+k;
      map[key] = (map[key] || 0) + 1;
    }
    const rows = Object.entries(map).map(([k,count]) => {
      const [brand, product] = k.split('__'); return { brand, product, count };
    }).sort((a, b) => b.count - a.count);
    return send(res, 200, rows);
  }
  if (p === '/api/my/overview' && req.method === 'GET') {
    const q = new URL(req.url, 'http://x').searchParams;
    const from = q.get('from') || '0000-01-01';
    const to = q.get('to') || '9999-12-31';
    const visits = readJSON(fVisits, []).filter(v => v.user_id === me.id && v.date >= from && v.date <= to);
    const total = visits.length;
    const unique = new Set(visits.map(v => v.doctor)).size;
    return send(res, 200, { total, unique });
  }

  notFound(res);
}

// ---------- Router ----------
const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  if (u.pathname.startsWith('/api/') || u.pathname === '/sse') return handleAPI(req, res);

  if (u.pathname === '/' || u.pathname === '/login') return serveText(res, loginRep);
  if (u.pathname === '/signup') return serveText(res, signupRep);
  if (u.pathname === '/login-admin') return serveText(res, loginAdmin);
  if (u.pathname === '/admin') return serveText(res, adminPage);
  if (u.pathname === '/admin-reports') return serveText(res, adminReports);
  if (u.pathname === '/rep') return serveText(res, repPage);

  if (u.pathname.startsWith('/uploads/')) {
    const fp = path.join(UPLOAD_DIR, path.basename(u.pathname));
    return serveFile(res, fp, 'image/*');
  }

  return notFound(res);
});

server.listen(PORT, () => {
  console.log('Server listening on http://localhost:' + PORT);
  console.log('مدیر: http://localhost:' + PORT + '/login-admin  (admin / admin)');
});
