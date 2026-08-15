// ============================================================
// LUBRICATION TRACKER — APP LOGIC
// Same UI logic as the original Apps Script index.html, but every
// google.script.run(...).withSuccessHandler(...).withFailureHandler(...)
// call has been converted to a plain async/await call against the
// functions exposed by supabase-api.js (getDashboardData, markLubricated,
// adminSaveLine, etc. — same names, same shapes).
// ============================================================

// ============================================================
// STATE
// ============================================================
var S = {
  page:'dashboard', equipId:null, partFilter:'all', globalFilter:'today',
  allEquip:[], allLines:[], allAreas:[],
  adminLines:[], adminAreas:[], adminEquip:[],
  gpPage:0, gpPageSize:50, gpTotal:0,
  schAll:null,
  adminTabLoaded:{}, adminData:null,
  histOffset:0, histTotal:0, histHasMore:false
};
var currentUser = null;
var _dd = null; // debounce timer

// ============================================================
// DATE HELPERS — avoid UTC timezone shift in IST (+5:30)
// new Date('2025-04-10') = UTC midnight → shows Apr 9 in IST.
// Parse manually to get a local midnight date.
// ============================================================
function parseLocalDate(str) {
  if (!str) return null;
  var p = String(str).split('-');
  if (p.length !== 3) return null;
  var d = new Date(parseInt(p[0]), parseInt(p[1])-1, parseInt(p[2]));
  d.setHours(0,0,0,0);
  return d;
}
function todayLocal() {
  var d = new Date(); d.setHours(0,0,0,0); return d;
}

// ============================================================
// INIT / AUTH
// ============================================================
window.onload = async function() {
  try {
    var { data: { session } } = await sb.auth.getSession();
    if (!session) { window.location.href = 'login.html'; return; }
    await afterLogin();
  } catch (e) {
    hideSplash();
    document.getElementById('splash-sub').textContent = 'Error: ' + e.message;
  }
};

// Redirect to the login page if the session ends (sign-out here, or in
// another tab, or an expired/invalid token).
if (typeof sb !== 'undefined') {
  sb.auth.onAuthStateChange(function(event, session) {
    if (event === 'SIGNED_OUT') { window.location.href = 'login.html'; }
  });
}

async function afterLogin() {
  try {
    currentUser = await getCurrentUserRole();
    hideSplash();
    if (currentUser.role === 'unauthorized') { renderDenied(); return; }
    document.getElementById('navbar').style.display = 'flex';
    document.getElementById('user-avatar').textContent = currentUser.avatar || currentUser.name.charAt(0).toUpperCase();
    document.getElementById('role-tag').textContent = currentUser.role;
    document.getElementById('role-tag').className = 'role-tag rt-' + currentUser.role;
    buildNav();
    if (currentUser.role === 'technician') showPage('technician');
    else showPage('dashboard');
  } catch (e) {
    hideSplash();
    renderDenied('Auth failed: ' + e.message);
  }
}

function hideSplash() {
  var s = document.getElementById('splash');
  s.classList.add('hide');
  setTimeout(function(){ s.style.display='none'; }, 380);
}

async function handleSignOut() {
  if (!confirm('Sign out?')) return;
  await sb.auth.signOut();
  window.location.href = 'login.html';
}

function renderDenied(msg) {
  document.body.innerHTML = '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:#F5F5F2;font-family:IBM Plex Sans,sans-serif">' +
    '<div style="background:#fff;border:1px solid #E2E2DC;border-radius:12px;padding:44px 38px;max-width:420px;width:90%;text-align:center;box-shadow:0 4px 20px rgba(0,0,0,.07)">' +
    '<div style="width:56px;height:56px;background:#FDF0EE;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 18px;font-size:26px">🔒</div>' +
    '<h1 style="font-size:20px;font-weight:700;margin-bottom:9px">Access Denied</h1>' +
    (msg ? '<p style="color:#6B6B6B;font-size:13px;line-height:1.6">' + msg + '</p>'
         : '<p style="color:#6B6B6B;font-size:13px;line-height:1.6">Your account is not registered in this app.<br>Ask your administrator to add you.</p>') +
    '<div style="margin-top:20px;padding:12px;background:#EDF2FB;border-radius:6px;font-size:12.5px;color:#1755A8">' +
    '<strong>Signed in as:</strong><br>' + (currentUser && currentUser.email ? currentUser.email : 'Unknown') + '</div>' +
    '<p style="margin-top:18px;font-size:11.5px;color:#A8A8A8">Ask your admin to add this email in Admin → Users, then sign out and back in.</p>' +
    '<button class="btn btn-ghost" style="margin-top:16px" onclick="handleSignOut()">Sign out</button>' +
    '</div></div>';
}

// ============================================================
// NAV
// ============================================================
function buildNav() {
  var h = '';
  if (currentUser.role !== 'technician')
    h += '<button class="nl" id="nl-dashboard" onclick="showPage(\'dashboard\')">Dashboard</button>';
  h += '<button class="nl" id="nl-technician" onclick="showPage(\'technician\')">Tasks</button>';
  if (currentUser.role !== 'technician')
    h += '<button class="nl" id="nl-schedule" onclick="showPage(\'schedule\')">Schedule</button>';
  if (currentUser.role !== 'technician')
    h += '<button class="nl" id="nl-line-history" onclick="showPage(\'line-history\')">Line History</button>';
  if (currentUser.role === 'admin')
    h += '<button class="nl" id="nl-admin" onclick="showPage(\'admin\')">Admin</button>';
  document.getElementById('nav-links').innerHTML = h;
}

function setActiveNav(page) {
  document.querySelectorAll('.nl').forEach(function(l){ l.classList.remove('on'); });
  var key = ({'global-parts':'dashboard','equipment':'dashboard','history':'dashboard'})[page] || page;
  var el = document.getElementById('nl-' + key);
  if (el) el.classList.add('on');
}

function showPage(page, params) {
  params = params || {};
  if (page === 'admin' && currentUser.role !== 'admin') return;
  if (['dashboard','global-parts','equipment','history','schedule'].indexOf(page) !== -1 && currentUser.role === 'technician') { showPage('technician'); return; }
  document.querySelectorAll('.pg').forEach(function(p){ p.classList.remove('on'); });
  var el = document.getElementById('page-' + page);
  if (!el) return;
  el.classList.add('on');
  S.page = page;
  setActiveNav(page);
  if      (page === 'dashboard')    loadDashboard();
  else if (page === 'technician')   loadTechnician();
  else if (page === 'global-parts') { S.globalFilter = params.filter || 'today'; S.gpPage = 0; loadGP(); }
  else if (page === 'equipment')    { if (params.id != null) S.equipId = params.id; S.partFilter = 'all'; resetPFilterTabs(); loadEqPage(); }
  else if (page === 'history')      { if (params.id != null) S.equipId = params.id; S.histOffset = 0; S.histTotal = 0; S.histHasMore = false; loadHist(false); }
  else if (page === 'schedule')     loadSchedule();
  else if (page === 'line-history') loadLHPage();
  else if (page === 'admin')        { S.adminData = null; S.adminTabLoaded = {}; showAdminTab('lines', document.querySelector('.atab')); }
}

function showAdminTab(name, el) {
  document.querySelectorAll('.atab-c').forEach(function(t){ t.classList.remove('on'); });
  document.querySelectorAll('.atab').forEach(function(b){ b.classList.remove('on'); });
  document.getElementById('atab-' + name).classList.add('on');
  if (el) el.classList.add('on');
  if (!S.adminTabLoaded[name]) {
    if (name === 'lines')    loadAdminLines();
    if (name === 'areas')    loadAdminAreas();
    if (name === 'equipment') loadAdminEquip();
    if (name === 'parts')    loadAdminParts();
    if (name === 'users')    loadAdminUsers();
    if (name === 'schedule') loadAdminSchedule();
    S.adminTabLoaded[name] = true;
  }
}

async function getAdminData() {
  if (S.adminData) return S.adminData;
  try {
    var d = await adminGetAllData();
    if (d && d.success) S.adminData = d;
    return d;
  } catch (e) {
    showErr('admin-error', e.message);
    return null;
  }
}
function invalidateAdmin() { S.adminData = null; S.adminTabLoaded = {}; }

// ============================================================
// HELPERS
// ============================================================
function toast(msg, isErr) {
  var t = document.getElementById('toast');
  t.textContent = msg; t.className = 'toast' + (isErr ? ' err' : '');
  t.classList.add('show');
  setTimeout(function(){ t.classList.remove('show'); setTimeout(function(){ t.className='toast'; }, 180); }, 3000);
}
function showErr(id, msg) { var e=document.getElementById(id); if(!e)return; e.textContent='Error: '+msg; e.style.display='block'; setTimeout(function(){e.style.display='none';},6000); }
function showMsg(id, msg, isErr) {
  var e=document.getElementById(id); if(!e)return;
  e.className=isErr?'err-bar':'ok-bar'; e.textContent=msg; e.style.display='block';
  setTimeout(function(){e.style.display='none';},3800);
}
function enc(o){ return encodeURIComponent(JSON.stringify(o)); }
function dec(s){ return JSON.parse(decodeURIComponent(s)); }
function popSel(id, items, vk, lf, ph) {
  var s=document.getElementById(id); if(!s)return;
  s.innerHTML=ph?'<option value="">'+ph+'</option>':'';
  (items||[]).forEach(function(x){ var o=document.createElement('option'); o.value=x[vk]; o.textContent=lf(x); s.appendChild(o); });
}
function debounce(fn,d){ return function(){ clearTimeout(_dd); _dd=setTimeout(fn,d); }; }

// Status badge — uses local date parse to avoid UTC timezone shift
function statusBadge(p) {
  if (!p.next_due) return '<span class="badge bg">No date</span>';
  var nd  = parseLocalDate(p.next_due);
  if (!nd) return '<span class="badge bg">No date</span>';
  var td  = todayLocal();
  var yes = String(p.lubricated).toLowerCase() === 'yes';
  if (nd.getTime() === td.getTime() && !yes) return '<span class="badge bw">Due Today</span>';
  if (nd.getTime() === td.getTime() &&  yes) return '<span class="badge bs">Done Today</span>';
  if (nd < td && !yes)                       return '<span class="badge bd">Missed</span>';
  if (yes && nd >= td)                       return '<span class="badge bs">Done</span>';
  return '<span class="badge bi">Upcoming</span>';
}

function exportCSV(tbodyId, filename) {
  var tbody = document.getElementById(tbodyId);
  var thead = tbody.parentElement.querySelector('thead');
  var rows  = [];
  if (thead) {
    var hs = thead.querySelectorAll('th');
    var hr = [];
    for (var j=0; j<hs.length-1; j++) hr.push('"'+hs[j].innerText.replace(/"/g,'""')+'"');
    rows.push(hr.join(','));
  }
  var trs = tbody.querySelectorAll('tr');
  for (var i=0; i<trs.length; i++) {
    var cols=trs[i].querySelectorAll('td'); if(cols.length<=1)continue;
    var row=[];
    for (var k=0;k<cols.length-1;k++) row.push('"'+cols[k].innerText.replace(/"/g,'""')+'"');
    rows.push(row.join(','));
  }
  dl(rows.join('\n'), filename, 'text/csv');
}
function dl(content, filename, type) {
  var blob=new Blob([content],{type:type});
  var a=document.createElement('a'); a.download=filename; a.href=URL.createObjectURL(blob); a.style.display='none';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

// Optimistic mark-done: grey out immediately, send RPC, revert on error
async function optimisticMark(btnId, partId, onOk) {
  var btn = document.getElementById(btnId);
  if (!btn) return;
  btn.disabled = true; btn.textContent = '✓ Done';
  btn.style.cssText = 'background:var(--green-l);color:var(--green);border:1px solid rgba(26,122,74,.22);font-size:11.5px;padding:4px 9px;border-radius:6px;cursor:default;font-weight:600;font-family:var(--font)';
  var tr = btn.closest('tr'); if (tr) tr.classList.add('done');
  try {
    var r = await markLubricated(partId);
    if (r && r.success) { toast('Logged ✓'); if (onOk) onOk(r); }
    else {
      if (btn) { btn.disabled=false; btn.textContent='Mark Done'; btn.style.cssText=''; btn.className='btn btn-success btn-sm'; }
      if (tr) tr.classList.remove('done');
      toast(r ? r.error : 'Error', true);
    }
  } catch (e) {
    if (btn) { btn.disabled=false; btn.textContent='Mark Done'; btn.style.cssText=''; btn.className='btn btn-success btn-sm'; }
    if (tr) tr.classList.remove('done');
    toast(e.message, true);
  }
}

// ============================================================
// DASHBOARD
// ============================================================
async function loadDashboard() {
  document.getElementById('dash-error').style.display='none';
  document.getElementById('dash-cards').innerHTML='<div style="grid-column:1/-1;text-align:center;padding:28px;color:var(--ink-4)">Loading…</div>';
  document.getElementById('dash-tbl').innerHTML='<tr><td colspan="5" class="loading-r">Loading…</td></tr>';
  try {
    var d = await getDashboardData(currentUser.area_ids||'');
    if (!d||!d.success) { showErr('dash-error', d?d.error:'No data'); return; }
    document.getElementById('dash-cards').innerHTML =
      '<div class="sc sc-blue" onclick="showPage(\'global-parts\',{filter:\'today\'})"><div class="sc-icon">📅</div><div class="sc-num">'+(d.stats.due_today||d.stats.dueToday||0)+'</div><div class="sc-lbl">Due Today</div></div>' +
      '<div class="sc sc-amber" onclick="showPage(\'global-parts\',{filter:\'week\'})"><div class="sc-icon">🗓</div><div class="sc-num">'+(d.stats.upcoming||0)+'</div><div class="sc-lbl">Upcoming (7d)</div></div>' +
      '<div class="sc sc-red" onclick="showPage(\'global-parts\',{filter:\'missed\'})"><div class="sc-icon">⚠️</div><div class="sc-num">'+(d.stats.missed||0)+'</div><div class="sc-lbl">Missed</div></div>';
    S.allEquip=d.equipment||[]; S.allLines=d.lines||[]; S.allAreas=d.areas||[];
    popSel('dash-line', d.lines, 'id', function(l){return l.name;}, 'All Lines');
    popSel('dash-area', d.areas, 'id', function(a){return a.name;}, 'All Areas');
    // Area restriction banner
    var banner = document.getElementById('dash-banner');
    if (currentUser.area_ids && currentUser.area_ids !== '' && d.areas && d.areas.length) {
      var myIds = currentUser.area_ids.split(',').map(function(x){return x.trim();});
      var names = d.areas.filter(function(a){return myIds.indexOf(String(a.id))!==-1;}).map(function(a){return a.name;});
      if (names.length) { banner.textContent='📍 Showing data for: '+names.join(', '); banner.style.display='block'; }
      else banner.style.display='none';
    } else { banner.style.display='none'; }
    renderDashTbl(S.allEquip);
  } catch (e) { showErr('dash-error', e.message); }
}

function renderDashTbl(equip) {
  var t=document.getElementById('dash-tbl');
  if (!equip||!equip.length) { t.innerHTML='<tr><td colspan="5" class="loading-r">No equipment. Add via Admin → Equipment.</td></tr>'; return; }
  var aMap={}, lMap={};
  S.allAreas.forEach(function(a){aMap[String(a.id)]=a.name;});
  S.allLines.forEach(function(l){lMap[String(l.id)]=l.name;});
  t.innerHTML = equip.map(function(e) {
    var canView = currentUser.role==='admin'||currentUser.role==='manager';
    var acts = canView
      ? '<button class="btn btn-primary btn-sm" onclick="showPage(\'equipment\',{id:\''+e.id+'\'})">Parts</button> <button class="btn btn-info btn-sm" onclick="showPage(\'history\',{id:\''+e.id+'\'})">History</button>'
      : '<span style="color:var(--ink-4);font-size:11.5px">—</span>';
    return '<tr><td>'+(lMap[String(e.line_id)]||'-')+'</td><td>'+(aMap[String(e.area_id)]||'-')+'</td>'+
      '<td><strong>'+(e.name||'')+'</strong></td><td><code>'+(e.code||'')+'</code></td><td>'+acts+'</td></tr>';
  }).join('');
}

var debouncedDash = debounce(applyDash, 280);
function dashLineChanged() {
  var lid=document.getElementById('dash-line').value;
  var filtered=lid?S.allAreas.filter(function(a){return String(a.line_id)===String(lid);}):S.allAreas;
  popSel('dash-area',filtered,'id',function(a){return a.name;},'All Areas');
  applyDash();
}
function applyDash() {
  var line=document.getElementById('dash-line').value;
  var area=document.getElementById('dash-area').value;
  var q=document.getElementById('dash-search').value.toLowerCase();
  renderDashTbl(S.allEquip.filter(function(e){
    return (!line||String(e.line_id)===String(line))&&(!area||String(e.area_id)===String(area))&&
           (!q||(e.name||'').toLowerCase().indexOf(q)!==-1||(e.code||'').toLowerCase().indexOf(q)!==-1);
  }));
}
function clearDash() {
  document.getElementById('dash-line').value='';
  document.getElementById('dash-area').value='';
  document.getElementById('dash-search').value='';
  popSel('dash-area',S.allAreas,'id',function(a){return a.name;},'All Areas');
  renderDashTbl(S.allEquip);
}

// ============================================================
// GLOBAL PARTS
// ============================================================
async function loadGP() {
  document.getElementById('gp-error').style.display='none';
  document.getElementById('gp-tbl').innerHTML='<tr><td colspan="10" class="loading-r">Loading…</td></tr>';
  document.getElementById('gp-pager').style.display='none';
  var titles={today:'Parts Due Today',week:'Upcoming — Next 7 Days',missed:'Missed Lubrications'};
  document.getElementById('gp-title').textContent=titles[S.globalFilter]||'Filtered Parts';
  document.getElementById('gp-sub').textContent='';
  try {
    var d = await getGlobalPartsFiltered(S.globalFilter,S.gpPage,S.gpPageSize,currentUser.area_ids||'');
    renderGP(d);
  } catch (e) { showErr('gp-error', e.message); }
}

function renderGP(d) {
  if (!d||!d.success) { showErr('gp-error', d?d.error:'Failed'); return; }
  S.gpTotal=d.total;
  document.getElementById('gp-sub').textContent=d.total+' parts found';
  var tbody=document.getElementById('gp-tbl');
  if (!d.parts.length) { tbody.innerHTML='<tr><td colspan="10"><div class="empty"><h3>All clear!</h3><p>No parts in this category.</p></div></td></tr>'; return; }
  tbody.innerHTML=d.parts.map(function(p){
    var isDone=String(p.lubricated).toLowerCase()==='yes';
    var act=isDone
      ?'<span style="color:var(--green);font-weight:600;font-size:12px">✓ Done</span>'
      :'<button class="btn btn-success btn-sm" id="gpb-'+p.id+'" onclick="gpMark(\''+p.id+'\')">Mark Done</button>';
    return '<tr'+(isDone?' class="done"':'')+'>'+
      '<td>'+(p.line_name||'-')+'</td><td>'+(p.area_name||'-')+'</td><td>'+(p.eq_name||'-')+'</td>'+
      '<td><code>'+(p.code||'-')+'</code></td><td><strong>'+(p.name||'')+'</strong></td>'+
      '<td>'+(p.lubricant_type||'-')+'</td><td>'+(p.frequency||'-')+'</td><td>'+(p.next_due||'-')+'</td>'+
      '<td>'+statusBadge(p)+'</td><td>'+act+'</td></tr>';
  }).join('');
  var pages=Math.ceil(S.gpTotal/S.gpPageSize);
  if (pages>1) {
    document.getElementById('gp-pager').style.display='flex';
    document.getElementById('gp-prev').disabled=S.gpPage===0;
    document.getElementById('gp-next').disabled=S.gpPage>=pages-1;
    document.getElementById('gp-info').textContent='Page '+(S.gpPage+1)+' of '+pages+' ('+S.gpTotal+' total)';
  }
}
function gpPage(dir){S.gpPage+=dir;loadGP();}
function gpMark(id){optimisticMark('gpb-'+id,id,function(){setTimeout(function(){if(S.page==='global-parts')loadGP();},1800);});}

// ============================================================
// FULL LUBRICATION SCHEDULE  (every part, every equipment —
// built from the same proven endpoints as Dashboard + Equipment
// pages: getDashboardData for the equipment list, then
// getEquipmentPageData(id,'all') per equipment for its parts.)
// ============================================================
async function loadSchedule() {
  document.getElementById('sch-error').style.display='none';
  document.getElementById('sch-tbl').innerHTML='<tr><td colspan="10" class="loading-r">Loading…</td></tr>';
  document.getElementById('sch-info').textContent='';
  try {
    if (!S.allEquip.length || !S.allLines.length) {
      var dd = await getDashboardData(currentUser.area_ids||'');
      if (dd && dd.success) { S.allEquip=dd.equipment||[]; S.allLines=dd.lines||[]; S.allAreas=dd.areas||[]; }
    }
    if (!S.allEquip.length) {
      document.getElementById('sch-tbl').innerHTML='<tr><td colspan="11"><div class="empty"><h3>No equipment yet</h3><p>Add lines, areas and equipment via Admin first.</p></div></td></tr>';
      return;
    }
    var lMap={}, aMap={};
    S.allLines.forEach(function(l){lMap[String(l.id)]=l.name;});
    S.allAreas.forEach(function(a){aMap[String(a.id)]=a.name;});

    var results = await Promise.all(S.allEquip.map(function(eq){
      return getEquipmentPageData(eq.id,'all').then(function(d){
        var parts = (d && d.success) ? (d.parts||[]) : [];
        return parts.map(function(p){
          return {
            line_id: eq.line_id, area_id: eq.area_id, equip_id: eq.id,
            line_name: lMap[String(eq.line_id)]||'-', area_name: aMap[String(eq.area_id)]||'-',
            eq_name: eq.name||'-', eq_code: eq.code||'-',
            code: p.code, name: p.name, lubricant_type: p.lubricant_type,
            frequency: p.frequency, last_done: p.last_done, next_due: p.next_due,
            lubricated: p.lubricated, id: p.id
          };
        });
      }).catch(function(){ return []; });
    }));

    S.schAll = [].concat.apply([], results);
    popSel('sch-line', S.allLines, 'id', function(l){return l.name;}, 'All Lines');
    popSel('sch-area', S.allAreas, 'id', function(a){return a.name;}, 'All Areas');
    var freqs = Array.from(new Set(S.schAll.map(function(p){return p.frequency;}).filter(Boolean))).sort();
    popSel('sch-freq', freqs.map(function(f){return {id:f,name:f};}), 'id', function(f){return f.name;}, 'All Frequencies');
    applySch();
  } catch (e) { showErr('sch-error', e.message); }
}

var debouncedSch = debounce(applySch, 250);

function schLineChanged() {
  var lid=document.getElementById('sch-line').value;
  var filtered=lid?S.allAreas.filter(function(a){return String(a.line_id)===String(lid);}):S.allAreas;
  popSel('sch-area',filtered,'id',function(a){return a.name;},'All Areas');
  applySch();
}

function applySch() {
  if (!S.schAll) return;
  var line=document.getElementById('sch-line').value;
  var area=document.getElementById('sch-area').value;
  var freq=document.getElementById('sch-freq').value;
  var q=document.getElementById('sch-search').value.toLowerCase();
  var rows = S.schAll.filter(function(p){
    return (!line||String(p.line_id)===String(line))
      && (!area||String(p.area_id)===String(area))
      && (!freq||p.frequency===freq)
      && (!q||(p.name||'').toLowerCase().indexOf(q)!==-1||(p.code||'').toLowerCase().indexOf(q)!==-1
              ||(p.lubricant_type||'').toLowerCase().indexOf(q)!==-1||(p.eq_name||'').toLowerCase().indexOf(q)!==-1);
  });
  renderSchTbl(rows);
}

function renderSchTbl(rows) {
  var tbody=document.getElementById('sch-tbl');
  document.getElementById('sch-info').textContent=rows.length+' part'+(rows.length===1?'':'s')+' in schedule';
  if (!rows.length) { tbody.innerHTML='<tr><td colspan="11"><div class="empty"><h3>No matching parts</h3><p>Try clearing filters.</p></div></td></tr>'; return; }
  tbody.innerHTML = rows.map(function(p){
    var canView = currentUser.role==='admin'||currentUser.role==='manager';
    var act = canView ? '<button class="btn btn-ghost btn-sm" onclick="showPage(\'equipment\',{id:\''+p.equip_id+'\'})">View</button>' : '';
    return '<tr><td>'+(p.line_name||'-')+'</td><td>'+(p.area_name||'-')+'</td><td>'+(p.eq_name||'-')+'</td>'+
      '<td><code>'+(p.code||'-')+'</code></td><td><strong>'+(p.name||'')+'</strong></td>'+
      '<td>'+(p.lubricant_type||'-')+'</td><td>'+(p.frequency||'-')+'</td>'+
      '<td>'+(p.last_done||'-')+'</td><td>'+(p.next_due||'-')+'</td>'+
      '<td>'+statusBadge(p)+'</td><td>'+act+'</td></tr>';
  }).join('');
}

function clearSch() {
  document.getElementById('sch-line').value='';
  document.getElementById('sch-area').value='';
  document.getElementById('sch-freq').value='';
  document.getElementById('sch-search').value='';
  popSel('sch-area', S.allAreas, 'id', function(a){return a.name;}, 'All Areas');
  applySch();
}

// ============================================================
// TECHNICIAN
// ============================================================
async function loadTechnician() {
  document.getElementById('tech-error').style.display='none';
  document.getElementById('tech-list').innerHTML='<p style="text-align:center;color:var(--ink-4);padding:28px">Loading…</p>';
  try {
    var d = await getTechnicianData();
    if (!d) { showErr('tech-error','No data'); return; }
    var td=new Date(); td.setHours(0,0,0,0);
    document.getElementById('tech-title').textContent='Tasks for '+td.toLocaleDateString('en-IN',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
    var c=document.getElementById('tech-list');
    if (!d.due_today||!d.due_today.length) {
      c.innerHTML='<div class="empty" style="background:var(--surface);border:1px solid var(--border);border-radius:var(--r-lg)"><div style="font-size:44px;margin-bottom:14px">✅</div><h3>All done!</h3><p>No lubrication tasks due today.</p></div>';
      return;
    }
    var freqColor={Daily:'#1A7A4A',Weekly:'#B07200',Quarterly:'#C5392A'};
    var freqBg={Daily:'#EAF5EE',Weekly:'#FEF6E0',Quarterly:'#FDF0EE'};
    c.innerHTML=d.due_today.map(function(p){
      var freq=p.frequency||'';
      var ac=freqColor[freq]||'#1755A8';
      var bg=freqBg[freq]||'#EDF2FB';
      return '<div class="part-card" id="tc-'+p.id+'">' +
        '<div class="pc-accent" style="background:'+ac+'"></div>' +
        '<div class="pc-body">' +
          '<div class="pc-crumb">' +
            '<span class="pc-crumb-seg" style="color:var(--blue);font-weight:600">'+(p.line_name||'-')+'</span>' +
            '<span class="pc-crumb-sep">›</span>' +
            '<span class="pc-crumb-seg">'+(p.area_name||'-')+'</span>' +
            '<span class="pc-crumb-sep">›</span>' +
            '<span class="pc-crumb-seg">'+(p.equipment_name||'-')+'</span>' +
          '</div>' +
          '<div class="pc-main">' +
            '<div class="pc-name">'+(p.name||'')+'</div>' +
            '<div style="flex-shrink:0;padding:2px 9px;border-radius:20px;font-size:11px;font-weight:700;background:'+bg+';color:'+ac+'">'+freq+'</div>' +
          '</div>' +
          '<div class="pc-foot">' +
            '<div class="pc-lub">Lubricant: <strong>'+(p.lubricant_type||'-')+'</strong></div>' +
            '<button class="btn btn-success btn-lg" id="tbtn-'+p.id+'" onclick="techMark(\''+p.id+'\')">' +
              '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1.5,6.5 4.5,9.5 10.5,2.5"/></svg> Mark Done' +
            '</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');
  } catch (e) { showErr('tech-error', e.message); }
}

async function techMark(partId) {
  var btn=document.getElementById('tbtn-'+partId);
  var card=document.getElementById('tc-'+partId);
  if (btn) { btn.disabled=true; btn.innerHTML='✓ Done'; btn.style.cssText='background:var(--green-l);color:var(--green);border:1px solid rgba(26,122,74,.22);font-size:12px;padding:6px 14px;border-radius:var(--r);cursor:default;font-weight:600;font-family:var(--font)'; }
  if (card) card.style.opacity='0.55';
  try {
    var r = await markLubricated(partId);
    if (r && r.success) {
      toast('Logged ✓');
      if (card) { card.style.transition='opacity .3s'; card.style.opacity='0'; setTimeout(function(){ card.remove(); },320); }
    } else {
      if (btn) { btn.disabled=false; btn.innerHTML='<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1.5,6.5 4.5,9.5 10.5,2.5"/></svg> Mark Done'; btn.style.cssText=''; btn.className='btn btn-success btn-lg'; }
      if (card) card.style.opacity='1';
      toast(r?r.error:'Error', true);
    }
  } catch (e) {
    if (btn) { btn.disabled=false; btn.style.cssText=''; btn.className='btn btn-success btn-lg'; }
    if (card) card.style.opacity='1';
    toast(e.message, true);
  }
}

// ============================================================
// EQUIPMENT PARTS
// ============================================================
async function loadEqPage() {
  document.getElementById('eq-error').style.display='none';
  document.getElementById('eq-head').innerHTML='<p>Loading…</p>';
  document.getElementById('parts-tbl').innerHTML='<tr><td colspan="8" class="loading-r">Loading…</td></tr>';
  try {
    var d = await getEquipmentPageData(S.equipId, S.partFilter);
    if (!d||!d.success) { showErr('eq-error', d?d.error:'Not found'); return; }
    var eq=d.equipment;
    document.getElementById('eq-head').innerHTML='<h2><code>'+eq.code+'</code> — '+eq.name+'</h2><p>Equipment ID: '+eq.id+'</p>';
    renderEqParts(d.parts, d.counts);
  } catch (e) { showErr('eq-error', e.message); }
}
function resetPFilterTabs(){ document.querySelectorAll('#page-equipment .fp').forEach(function(f){f.classList.remove('on');}); document.querySelector('#page-equipment .fp').classList.add('on'); }
function setPartFilter(f,el){ S.partFilter=f; document.querySelectorAll('#page-equipment .fp').forEach(function(t){t.classList.remove('on');}); el.classList.add('on'); loadEqFiltered(f); }
async function loadEqFiltered(f){
  document.getElementById('parts-tbl').innerHTML='<tr><td colspan="8" class="loading-r">Loading…</td></tr>';
  try {
    var d = await getEquipmentPageData(S.equipId, f);
    if (!d||!d.success){document.getElementById('parts-tbl').innerHTML='<tr><td colspan="8" style="color:var(--red);padding:18px;text-align:center">Error</td></tr>';return;}
    renderEqParts(d.parts, d.counts);
  } catch (e) { document.getElementById('parts-tbl').innerHTML='<tr><td colspan="8" style="color:var(--red);padding:18px;text-align:center">'+e.message+'</td></tr>'; }
}
function renderEqParts(parts, counts) {
  if (counts) {
    document.getElementById('cnt-all').textContent='('+(counts.all||0)+')';
    document.getElementById('cnt-today').textContent='('+(counts.today||0)+')';
    document.getElementById('cnt-week').textContent='('+(counts.week||0)+')';
    document.getElementById('cnt-missed').textContent='('+(counts.missed||0)+')';
  }
  var tbody=document.getElementById('parts-tbl');
  if (!parts||!parts.length) { tbody.innerHTML='<tr><td colspan="8" class="loading-r">No parts for this filter.</td></tr>'; return; }
  tbody.innerHTML=parts.map(function(p){
    var isDone=String(p.lubricated).toLowerCase()==='yes';
    var act=isDone
      ?'<span style="color:var(--green);font-weight:600;font-size:12px">✓ Done</span>'
      :'<button class="btn btn-success btn-sm" id="pb-'+p.id+'" onclick="eqMark(\''+p.id+'\')">Mark Done</button>';
    return '<tr'+(isDone?' class="done"':'')+'>'+
      '<td><code>'+(p.code||'-')+'</code></td><td><strong>'+(p.name||'')+'</strong></td>'+
      '<td>'+(p.lubricant_type||'-')+'</td><td>'+(p.frequency||'-')+'</td>'+
      '<td>'+(p.last_done||'-')+'</td><td>'+(p.next_due||'-')+'</td>'+
      '<td>'+statusBadge(p)+'</td><td>'+act+'</td></tr>';
  }).join('');
}
function eqMark(id){optimisticMark('pb-'+id,id,function(){setTimeout(function(){if(S.page==='equipment')loadEqFiltered(S.partFilter);},1800);});}

// ============================================================
// EQUIPMENT HISTORY
// ============================================================
async function loadHist(append) {
  document.getElementById('hist-error').style.display='none';
  if (!append) {
    document.getElementById('hist-head').innerHTML='<p>Loading…</p>';
    document.getElementById('hist-tbl').innerHTML='<tr><td colspan="9" class="loading-r">Loading…</td></tr>';
    document.getElementById('hist-lm').style.display='none';
    document.getElementById('hist-count').textContent='';
  } else {
    var b=document.getElementById('hist-lm-btn'); if(b){b.disabled=true;b.textContent='Loading…';}
  }
  try {
    var d = await getEquipmentHistory(S.equipId, append?S.histOffset:0);
    if (!d||!d.success) { showErr('hist-error',d?d.error:'No data'); return; }
    S.histTotal=d.total; S.histHasMore=d.hasMore; S.histOffset=d.offset+d.history.length;
    var eq=d.equipment||{};
    document.getElementById('hist-head').innerHTML='<h2>'+(eq.code?'<code>'+eq.code+'</code> — ':'')+eq.name+'</h2>';
    document.getElementById('hist-count').textContent='Showing '+S.histOffset+' of '+S.histTotal;
    var tbody=document.getElementById('hist-tbl');
    var rows=(d.history||[]).map(function(h,i){
      return '<tr><td>'+(d.offset+i+1)+'</td><td>'+h.line_name+'</td><td>'+h.area_name+'</td><td>'+h.equipment_name+'</td>'+
        '<td><strong>'+(h.part_name||'-')+'</strong></td><td>'+h.lubricated_on+'</td>'+
        '<td style="font-size:11.5px;color:var(--ink-3)">'+h.lubricated_by+'</td>'+
        '<td>'+h.frequency+'</td><td>'+h.next_due+'</td></tr>';
    }).join('');
    if (append) document.getElementById('hist-tbl').insertAdjacentHTML('beforeend', rows);
    else tbody.innerHTML=rows||'<tr><td colspan="9" class="loading-r">No history yet.</td></tr>';
    var lm=document.getElementById('hist-lm'),lb=document.getElementById('hist-lm-btn'),li=document.getElementById('hist-lm-info');
    if (S.histHasMore) { lm.style.display='block';lb.disabled=false;lb.textContent='Load More';li.textContent=(S.histTotal-S.histOffset)+' more'; }
    else lm.style.display='none';
  } catch (e) {
    showErr('hist-error',e.message);
    var b2=document.getElementById('hist-lm-btn'); if(b2){b2.disabled=false;b2.textContent='Load More';}
  }
}
function loadMoreHist(){ loadHist(true); }
async function exportHistFull() {
  var btn=document.getElementById('hist-export-btn'); if(btn){btn.disabled=true;btn.textContent='Fetching…';}
  try {
    var d = await getEquipmentHistoryFull(S.equipId);
    if(btn){btn.disabled=false;btn.textContent='↓ Export All';}
    if(!d||!d.success||!d.history||!d.history.length){toast('Nothing to export',true);return;}
    var h=['#','Line','Area','Equipment','Part','Lubricated On','By','Frequency','Next Due'];
    var rows=[h.map(function(x){return'"'+x+'"';}).join(',')];
    d.history.forEach(function(r,i){
      rows.push([i+1,'"'+(r.line_name||'').replace(/"/g,'""')+'"','"'+(r.area_name||'').replace(/"/g,'""')+'"',
        '"'+(r.equipment_name||'').replace(/"/g,'""')+'"','"'+(r.part_name||'').replace(/"/g,'""')+'"',
        '"'+(r.lubricated_on||'')+'"','"'+(r.lubricated_by||'').replace(/"/g,'""')+'"','"'+(r.frequency||'')+'"','"'+(r.next_due||'')+'"'].join(','));
    });
    dl(rows.join('\n'), 'History_Full.csv', 'text/csv');
    toast('Exported '+d.history.length+' records');
  } catch (e) {
    if(btn){btn.disabled=false;btn.textContent='↓ Export All';}
    toast(e.message,true);
  }
}

// ============================================================
// LINE HISTORY — paginated
// ============================================================
var _lh = { lineId:null, offset:0, total:0, hasMore:false };

async function loadLHPage() {
  document.getElementById('lh-error').style.display='none';
  document.getElementById('lh-panel').style.display='none';
  document.getElementById('lh-summary').style.display='none';
  document.getElementById('lh-export').disabled=true;
  _lh={lineId:null,offset:0,total:0,hasMore:false};
  try {
    // Use getDashboardData to get lines (respects area restriction via RLS)
    var d = await getDashboardData(currentUser.area_ids||'');
    if (!d||!d.success) { showErr('lh-error','Failed to load lines'); return; }
    var sel=document.getElementById('lh-sel');
    sel.innerHTML='<option value="">— Select a Line —</option>';
    (d.lines||[]).forEach(function(l){
      var o=document.createElement('option'); o.value=l.id; o.textContent=l.name; sel.appendChild(o);
    });
  } catch (e) { showErr('lh-error', e.message); }
}

function lhLineChanged() {
  var id=document.getElementById('lh-sel').value;
  if (!id) { document.getElementById('lh-panel').style.display='none'; document.getElementById('lh-summary').style.display='none'; document.getElementById('lh-export').disabled=true; return; }
  _lh.lineId=id; _lh.offset=0;
  loadLH(false);
}

async function loadLH(append) {
  document.getElementById('lh-error').style.display='none';
  if (!append) {
    document.getElementById('lh-tbl').innerHTML='<tr><td colspan="9" class="loading-r">Loading…</td></tr>';
    document.getElementById('lh-lm').style.display='none';
    document.getElementById('lh-count').textContent='';
  } else {
    var b=document.getElementById('lh-lm-btn'); if(b){b.disabled=true;b.textContent='Loading…';}
  }
  try {
    var d = await getLineHistory(_lh.lineId, append?_lh.offset:0);
    if (!d||!d.success) { showErr('lh-error',d?d.error:'No data'); return; }
    _lh.total=d.total; _lh.hasMore=d.hasMore; _lh.offset=d.offset+d.history.length;
    document.getElementById('lh-panel').style.display='block';
    document.getElementById('lh-export').disabled=false;
    document.getElementById('lh-panel-title').textContent=(d.line?d.line.name:'')+' — History';
    var sum=document.getElementById('lh-summary');
    sum.style.display='block'; sum.textContent=d.total+' total records for '+(d.line?d.line.name:'this line');
    document.getElementById('lh-count').textContent='Showing '+_lh.offset+' of '+_lh.total;
    var tbody=document.getElementById('lh-tbl');
    var rows=(d.history||[]).map(function(h,i){
      return '<tr><td>'+(d.offset+i+1)+'</td><td>'+h.line_name+'</td><td>'+h.area_name+'</td><td>'+h.equipment_name+'</td>'+
        '<td><strong>'+h.part_name+'</strong></td><td>'+h.lubricated_on+'</td>'+
        '<td style="font-size:11.5px;color:var(--ink-3)">'+h.lubricated_by+'</td>'+
        '<td>'+h.frequency+'</td><td>'+h.next_due+'</td></tr>';
    }).join('');
    if (append) tbody.insertAdjacentHTML('beforeend', rows);
    else tbody.innerHTML=rows||'<tr><td colspan="9" class="loading-r">No history for this line.</td></tr>';
    var lm=document.getElementById('lh-lm'),lb=document.getElementById('lh-lm-btn'),li=document.getElementById('lh-lm-info');
    if (_lh.hasMore) { lm.style.display='block';lb.disabled=false;lb.textContent='Load More';li.textContent=(_lh.total-_lh.offset)+' more'; }
    else lm.style.display='none';
  } catch (e) {
    showErr('lh-error',e.message);
    var b2=document.getElementById('lh-lm-btn'); if(b2){b2.disabled=false;b2.textContent='Load More';}
  }
}
function loadMoreLH(){ loadLH(true); }

async function exportLHFull() {
  if (!_lh.lineId) return;
  var btn=document.getElementById('lh-export'); if(btn){btn.disabled=true;btn.textContent='Fetching…';}
  try {
    var d = await getLineHistoryFull(_lh.lineId);
    if(btn){btn.disabled=false;btn.textContent='↓ Export All';}
    if(!d||!d.success||!d.history||!d.history.length){toast('Nothing to export',true);return;}
    var h=['#','Line','Area','Equipment','Part','Lubricated On','By','Frequency','Next Due'];
    var rows=[h.map(function(x){return'"'+x+'"';}).join(',')];
    d.history.forEach(function(r,i){
      rows.push([i+1,'"'+(r.line_name||'').replace(/"/g,'""')+'"','"'+(r.area_name||'').replace(/"/g,'""')+'"',
        '"'+(r.equipment_name||'').replace(/"/g,'""')+'"','"'+(r.part_name||'').replace(/"/g,'""')+'"',
        '"'+(r.lubricated_on||'')+'"','"'+(r.lubricated_by||'').replace(/"/g,'""')+'"','"'+(r.frequency||'')+'"','"'+(r.next_due||'')+'"'].join(','));
    });
    var sel=document.getElementById('lh-sel'); var ln=sel.options[sel.selectedIndex]?sel.options[sel.selectedIndex].text:'Line';
    dl(rows.join('\n'), ln+'_History.csv', 'text/csv');
    toast('Exported '+d.history.length+' records');
  } catch (e) {
    if(btn){btn.disabled=false;btn.textContent='↓ Export All';}
    toast(e.message,true);
  }
}

// ============================================================
// ADMIN — Lines
// ============================================================
async function loadAdminLines() {
  var d = await getAdminData();
  if(!d||!d.success){showErr('admin-error',d?d.error:'Failed');return;}
  S.adminLines=d.lines||[];
  var t=document.getElementById('lines-tbl');
  if(!S.adminLines.length){t.innerHTML='<tr><td colspan="3" class="loading-r">No lines yet.</td></tr>';return;}
  t.innerHTML=S.adminLines.map(function(l){
    return '<tr><td><code>'+l.id+'</code></td><td><strong>'+l.name+'</strong></td>'+
      '<td><button class="btn btn-warn btn-sm" onclick="editLine(dec(\''+enc(l)+'\'))">Edit</button> '+
      '<button class="btn btn-danger btn-sm" onclick="deleteLine('+l.id+')">Delete</button></td></tr>';
  }).join('');
}
function editLine(l){document.getElementById('line-id').value=l.id;document.getElementById('line-name').value=l.name||'';document.getElementById('line-form-title').innerHTML='<span class="step-dot">1</span> Edit Line';}
function resetLineForm(){document.getElementById('line-id').value='';document.getElementById('line-name').value='';document.getElementById('line-form-title').innerHTML='<span class="step-dot">1</span> Add Production Line';}
async function saveLine(){
  var n=document.getElementById('line-name').value.trim();
  if(!n){showMsg('line-msg','Line name required',true);return;}
  try {
    var r = await adminSaveLine({id:document.getElementById('line-id').value||null,name:n});
    if(r&&r.success){showMsg('line-msg',r.message||'Saved');resetLineForm();invalidateAdmin();loadAdminLines();}
    else showMsg('line-msg',r?r.error:'Failed',true);
  } catch (e) { showMsg('line-msg',e.message,true); }
}
async function deleteLine(id){if(!confirm('Delete this line?'))return; await adminDeleteLine(id); invalidateAdmin(); loadAdminLines();}

// ADMIN — Areas
async function loadAdminAreas() {
  var d = await getAdminData();
  if(!d||!d.success){showErr('admin-error',d?d.error:'Failed');return;}
  S.adminLines=d.lines||[];S.adminAreas=d.areas||[];
  popSel('area-line',d.lines,'id',function(l){return l.name;},'— Select Line —');
  var lm={};d.lines.forEach(function(l){lm[String(l.id)]=l.name;});
  var t=document.getElementById('areas-tbl');
  if(!S.adminAreas.length){t.innerHTML='<tr><td colspan="4" class="loading-r">No areas yet.</td></tr>';return;}
  t.innerHTML=S.adminAreas.map(function(a){
    return '<tr><td><code>'+a.id+'</code></td><td><strong>'+a.name+'</strong></td><td>'+(lm[String(a.line_id)]||'-')+'</td>'+
      '<td><button class="btn btn-warn btn-sm" onclick="editArea(dec(\''+enc(a)+'\'))">Edit</button> '+
      '<button class="btn btn-danger btn-sm" onclick="deleteArea('+a.id+')">Delete</button></td></tr>';
  }).join('');
}
function editArea(a){document.getElementById('area-id').value=a.id;document.getElementById('area-name').value=a.name||'';document.getElementById('area-line').value=a.line_id||'';}
function resetAreaForm(){document.getElementById('area-id').value='';document.getElementById('area-name').value='';document.getElementById('area-line').value='';}
async function saveArea(){
  var n=document.getElementById('area-name').value.trim(),lid=document.getElementById('area-line').value;
  if(!n){showMsg('area-msg','Area name required',true);return;}if(!lid){showMsg('area-msg','Select a Line',true);return;}
  try {
    var r = await adminSaveArea({id:document.getElementById('area-id').value||null,name:n,line_id:lid});
    if(r&&r.success){showMsg('area-msg','Saved');resetAreaForm();invalidateAdmin();loadAdminAreas();}
    else showMsg('area-msg',r?r.error:'Failed',true);
  } catch (e) { showMsg('area-msg',e.message,true); }
}
async function deleteArea(id){if(!confirm('Delete?'))return; await adminDeleteArea(id); invalidateAdmin(); loadAdminAreas();}

// ADMIN — Equipment
async function loadAdminEquip() {
  var d = await getAdminData();
  if(!d||!d.success){showErr('admin-error',d?d.error:'Failed');return;}
  S.adminLines=d.lines||[];S.adminAreas=d.areas||[];S.adminEquip=d.equipment||[];
  popSel('eq-line',d.lines,'id',function(l){return l.name;},'— Select Line —');
  document.getElementById('eq-area').innerHTML='<option value="">— Select Line first —</option>';document.getElementById('eq-area').disabled=true;
  popSel('eq-copy',d.equipment,'id',function(e){return e.code+' — '+e.name;},'— Don\'t copy —');
  var am={},lm={};d.areas.forEach(function(a){am[String(a.id)]=a.name;});d.lines.forEach(function(l){lm[String(l.id)]=l.name;});
  var t=document.getElementById('eq-tbl');
  if(!S.adminEquip.length){t.innerHTML='<tr><td colspan="5" class="loading-r">No equipment yet.</td></tr>';return;}
  t.innerHTML=S.adminEquip.map(function(e){
    return '<tr><td><code>'+(e.code||'')+'</code></td><td><strong>'+(e.name||'')+'</strong></td>'+
      '<td>'+(am[String(e.area_id)]||'-')+'</td><td>'+(lm[String(e.line_id)]||'-')+'</td>'+
      '<td><button class="btn btn-warn btn-sm" onclick="editEquip(dec(\''+enc(e)+'\'))">Edit</button> '+
      '<button class="btn btn-danger btn-sm" onclick="deleteEquip('+e.id+')">Delete</button></td></tr>';
  }).join('');
}
function eqLineChanged(){var lid=document.getElementById('eq-line').value,s=document.getElementById('eq-area');if(!lid){s.innerHTML='<option value="">— Select Line first —</option>';s.disabled=true;return;}var f=S.adminAreas.filter(function(a){return String(a.line_id)===String(lid);});s.disabled=false;popSel('eq-area',f,'id',function(a){return a.name;},'— Select Area —');}
function editEquip(e){document.getElementById('eq-id').value=e.id;document.getElementById('eq-name').value=e.name||'';document.getElementById('eq-code').value=e.code||'';document.getElementById('eq-line').value=e.line_id||'';eqLineChanged();document.getElementById('eq-area').value=e.area_id||'';}
function resetEqForm(){document.getElementById('eq-id').value='';document.getElementById('eq-name').value='';document.getElementById('eq-code').value='';document.getElementById('eq-line').value='';document.getElementById('eq-area').innerHTML='<option value="">— Select Line first —</option>';document.getElementById('eq-area').disabled=true;document.getElementById('eq-copy').value='';}
async function saveEquipment(){
  var n=document.getElementById('eq-name').value.trim(),c=document.getElementById('eq-code').value.trim();
  var lid=document.getElementById('eq-line').value,aid=document.getElementById('eq-area').value;
  if(!n){showMsg('eq-msg','Name required',true);return;}if(!c){showMsg('eq-msg','Code required',true);return;}
  if(!lid){showMsg('eq-msg','Select a Line',true);return;}if(!aid){showMsg('eq-msg','Select an Area',true);return;}
  try {
    var r = await adminSaveEquipment({id:document.getElementById('eq-id').value||null,name:n,code:c,area_id:aid,line_id:lid,copy_from_equipment_id:document.getElementById('eq-copy').value||null});
    if(r&&r.success){showMsg('eq-msg','Saved');resetEqForm();invalidateAdmin();loadAdminEquip();}
    else showMsg('eq-msg',r?r.error:'Failed',true);
  } catch (e) { showMsg('eq-msg',e.message,true); }
}
async function deleteEquip(id){if(!confirm('Delete?'))return; await adminDeleteEquipment(id); invalidateAdmin(); loadAdminEquip();}

// ADMIN — Parts
async function loadAdminParts() {
  var d = await getAdminData();
  if(!d||!d.success){showErr('admin-error',d?d.error:'Failed');return;}
  S.adminLines=d.lines||[];S.adminAreas=d.areas||[];S.adminEquip=d.equipment||[];
  popSel('p-line',d.lines,'id',function(l){return l.name;},'— Select Line —');
  document.getElementById('p-area').innerHTML='<option value="">— Select Line first —</option>';document.getElementById('p-area').disabled=true;
  document.getElementById('p-equipment').innerHTML='<option value="">— Select Area first —</option>';document.getElementById('p-equipment').disabled=true;
  var am={},lm={},em={};
  d.areas.forEach(function(a){am[String(a.id)]=a;});d.lines.forEach(function(l){lm[String(l.id)]=l.name;});d.equipment.forEach(function(e){em[String(e.id)]=e;});
  var t=document.getElementById('parts-tbl-admin');
  var parts=d.parts||[];
  if(!parts.length){t.innerHTML='<tr><td colspan="9" class="loading-r">No parts yet.</td></tr>';return;}
  t.innerHTML=parts.map(function(p){
    var e=em[String(p.equipment_id)]||{},a=am[String(e.area_id)]||{};
    return '<tr><td><code>'+(p.code||'-')+'</code></td><td><strong>'+(p.name||'')+'</strong></td>'+
      '<td>'+(e.name||'-')+'</td><td>'+(a.name||'-')+'</td><td>'+(lm[String(e.line_id)]||'-')+'</td>'+
      '<td>'+(p.lubricant_type||'-')+'</td><td>'+(p.frequency||'-')+'</td><td>'+(p.next_due||'-')+'</td>'+
      '<td><button class="btn btn-warn btn-sm" onclick="editPart(dec(\''+enc(p)+'\'))">Edit</button> '+
      '<button class="btn btn-danger btn-sm" onclick="deletePart('+p.id+')">Delete</button></td></tr>';
  }).join('');
}
function partLineChanged(){var lid=document.getElementById('p-line').value,pa=document.getElementById('p-area'),pe=document.getElementById('p-equipment');pe.innerHTML='<option value="">— Select Area first —</option>';pe.disabled=true;if(!lid){pa.innerHTML='<option value="">— Select Line first —</option>';pa.disabled=true;return;}var f=S.adminAreas.filter(function(a){return String(a.line_id)===String(lid);});pa.disabled=false;popSel('p-area',f,'id',function(a){return a.name;},'— Select Area —');}
function partAreaChanged(){var aid=document.getElementById('p-area').value,pe=document.getElementById('p-equipment');if(!aid){pe.innerHTML='<option value="">— Select Area first —</option>';pe.disabled=true;return;}var f=S.adminEquip.filter(function(e){return String(e.area_id)===String(aid);});pe.disabled=false;popSel('p-equipment',f,'id',function(e){return e.code+' — '+e.name;},'— Select Equipment —');}
function editPart(p){var e=S.adminEquip.find(function(x){return String(x.id)===String(p.equipment_id);})||{};document.getElementById('p-line').value=e.line_id||'';partLineChanged();document.getElementById('p-area').value=e.area_id||'';partAreaChanged();document.getElementById('p-equipment').value=p.equipment_id||'';document.getElementById('part-id').value=p.id;document.getElementById('p-name').value=p.name||'';document.getElementById('p-code').value=p.code||'';document.getElementById('p-lubricant').value=p.lubricant_type||'';document.getElementById('p-frequency').value=p.frequency||'Monthly';document.getElementById('p-nextdue').value=p.next_due||'';window.scrollTo(0,0);}
function resetPartForm(){document.getElementById('part-id').value='';document.getElementById('p-line').value='';document.getElementById('p-area').innerHTML='<option value="">— Select Line first —</option>';document.getElementById('p-area').disabled=true;document.getElementById('p-equipment').innerHTML='<option value="">— Select Area first —</option>';document.getElementById('p-equipment').disabled=true;document.getElementById('p-name').value='';document.getElementById('p-code').value='';document.getElementById('p-lubricant').value='';document.getElementById('p-nextdue').value='';document.getElementById('p-frequency').value='Monthly';}
async function savePart(){
  var eid=document.getElementById('p-equipment').value,n=document.getElementById('p-name').value.trim();
  if(!document.getElementById('p-line').value){showMsg('part-msg','Select a Line',true);return;}
  if(!document.getElementById('p-area').value){showMsg('part-msg','Select an Area',true);return;}
  if(!eid){showMsg('part-msg','Select Equipment',true);return;}if(!n){showMsg('part-msg','Part name required',true);return;}
  try {
    var r = await adminSavePart({id:document.getElementById('part-id').value||null,equipment_id:eid,name:n,code:document.getElementById('p-code').value.trim()||null,lubricant_type:document.getElementById('p-lubricant').value.trim(),frequency:document.getElementById('p-frequency').value,next_due:document.getElementById('p-nextdue').value});
    if(r&&r.success){showMsg('part-msg','Saved');resetPartForm();invalidateAdmin();loadAdminParts();}
    else showMsg('part-msg',r?r.error:'Failed',true);
  } catch (e) { showMsg('part-msg',e.message,true); }
}
async function deletePart(id){if(!confirm('Delete?'))return; await adminDeletePart(id); invalidateAdmin(); loadAdminParts();}

// ============================================================
// ADMIN — Schedule Tab
// ============================================================
var _sched = { line:{preview:null,params:{}}, area:{preview:null,params:{}} };

async function loadAdminSchedule() {
  var d = await getAdminData();
  if(!d||!d.success)return;
  S.adminLines=d.lines||[];S.adminAreas=d.areas||[];
  popSel('sl-line',d.lines,'id',function(l){return l.name;},'— Select Line —');
  popSel('sa-line',d.lines,'id',function(l){return l.name;},'— Select Line —');
  document.getElementById('sa-area').innerHTML='<option value="">— Select Line first —</option>';
  document.getElementById('sa-area').disabled=true;
}

function schedTab(tab) {
  document.getElementById('ss-line').style.display=tab==='line'?'block':'none';
  document.getElementById('ss-area').style.display=tab==='area'?'block':'none';
  var sl=document.getElementById('sst-line'),sa=document.getElementById('sst-area');
  sl.className='sst'+(tab==='line'?' on-amber':'');
  sa.className='sst'+(tab==='area'?' on-blue':'');
}

function schedAreaLineChanged(){
  var lid=document.getElementById('sa-line').value,s=document.getElementById('sa-area');
  if(!lid){s.innerHTML='<option value="">— Select Line first —</option>';s.disabled=true;return;}
  var f=S.adminAreas.filter(function(a){return String(a.line_id)===String(lid);});
  s.disabled=false;s.innerHTML='<option value="">— Select Area —</option>';
  f.forEach(function(a){var o=document.createElement('option');o.value=a.id;o.textContent=a.name;s.appendChild(o);});
}

async function schedPreview(mode) {
  var isL=mode==='line',pfx=isL?'sl':'sa';
  var lid=document.getElementById(pfx+'-line').value;
  var aid=isL?'':document.getElementById('sa-area').value;
  var dt=document.getElementById(pfx+'-date').value;
  var sc=document.getElementById(pfx+'-scope').value;
  var mid=isL?'sched-line-msg':'sched-area-msg';
  if(!lid){showMsg(mid,'Select a Line',true);return;}
  if(!isL&&!aid){showMsg(mid,'Select an Area',true);return;}
  if(!dt){showMsg(mid,'Enter an Anchor Date',true);return;}
  var btn=document.getElementById(pfx+'-prev-btn');
  btn.disabled=true;btn.textContent='⏳ Loading…';
  document.getElementById(pfx+'-preview').style.display='none';
  document.getElementById(pfx+'-success').style.display='none';
  _sched[mode].params={lineId:lid,areaId:aid,date:dt,scope:sc};
  try {
    var r = await adminBulkSchedule(lid,aid,dt,sc,true);
    btn.disabled=false;btn.textContent='👁 Preview';
    if(!r||!r.success){showMsg(mid,r?r.error:'Failed',true);return;}
    _sched[mode].preview=r;
    renderSchedPreview(mode,r);
  } catch (e) { btn.disabled=false;btn.textContent='👁 Preview'; showMsg(mid,e.message,true); }
}

function renderSchedPreview(mode,r) {
  var isL=mode==='line',pfx=isL?'sl':'sa';
  var p=_sched[mode].params;
  var lsel=document.getElementById(pfx+'-line');
  var lname=lsel.options[lsel.selectedIndex]?lsel.options[lsel.selectedIndex].text:'';
  var aname='';
  if(!isL){var asel=document.getElementById('sa-area');aname=asel.options[asel.selectedIndex]?' › '+asel.options[asel.selectedIndex].text:'';}
  var scopeLabel=p.scope==='empty'?'empty parts only':'all parts (overwrite)';
  document.getElementById(pfx+'-meta').textContent=r.count+' parts · '+lname+aname+' · '+p.date+' · '+scopeLabel;
  // Frequency summary
  var fc={};r.preview.forEach(function(x){fc[x.frequency]=(fc[x.frequency]||0)+1;});
  var fclr={Daily:'var(--blue)',Weekly:'var(--green)',Monthly:'var(--amber)',Quarterly:'var(--red)'};
  document.getElementById(pfx+'-sumbar').innerHTML=Object.keys(fc).map(function(f){
    return '<div class="sb-cell"><span style="font-weight:700;color:'+(fclr[f]||'var(--ink-3)')+'">'+fc[f]+'</span> <span style="color:var(--ink-3)">'+f+'</span></div>';
  }).join('')+'<div class="sb-cell" style="margin-left:auto"><strong style="color:var(--ink)">'+r.count+'</strong> <span style="color:var(--ink-3)">Total</span></div>';
  // Table
  document.getElementById(pfx+'-prev-tbl').innerHTML=r.preview.map(function(x,i){
    var ws=x.old_due==='(none)'?'color:var(--ink-4);font-style:italic':'color:var(--red);text-decoration:line-through';
    var mid2=isL?'<td>'+x.area_name+'</td><td><strong>'+x.equip_name+'</strong></td>':'<td><strong>'+x.equip_name+'</strong></td>';
    return '<tr><td style="color:var(--ink-4);font-size:11.5px">'+(i+1)+'</td>'+mid2+'<td><code>'+x.part_code+'</code></td>'+
      '<td>'+x.part_name+'</td><td><span class="badge bi">'+x.frequency+'</span></td>'+
      '<td style="'+ws+';font-size:12px">'+x.old_due+'</td>'+
      '<td style="color:var(--green);font-weight:700">'+x.new_due+'</td></tr>';
  }).join('');
  document.getElementById(pfx+'-preview').style.display='block';
  document.getElementById(pfx+'-preview').scrollIntoView({behavior:'smooth',block:'start'});
}

async function schedConfirm(mode) {
  var st=_sched[mode];
  if(!st.preview||!st.params.lineId||!st.params.date){toast('Run preview first',true);return;}
  var pfx=mode==='line'?'sl':'sa';
  var p=st.params;
  var btns=[document.getElementById(pfx+'-confirm'),document.getElementById(pfx+'-confirm2')];
  btns.forEach(function(b){if(b){b.disabled=true;b.textContent='⏳ Applying…';}});
  try {
    var r = await adminBulkSchedule(p.lineId,p.areaId,p.date,p.scope,false);
    btns.forEach(function(b){if(b){b.disabled=false;b.textContent='✓ Apply';}});
    if(!r||!r.success){toast(r?r.error:'Failed',true);return;}
    document.getElementById(pfx+'-preview').style.display='none';
    var lsel=document.getElementById(pfx+'-line');
    var lname=lsel.options[lsel.selectedIndex]?lsel.options[lsel.selectedIndex].text:'';
    var aname='';
    if(mode==='area'){var as=document.getElementById('sa-area');aname=as.options[as.selectedIndex]?' › '+as.options[as.selectedIndex].text:'';}
    document.getElementById(pfx+'-succ-msg').textContent=r.message;
    document.getElementById(pfx+'-succ-sub').innerHTML='<strong>'+lname+aname+'</strong><br>'+r.updated+' parts scheduled from <strong>'+p.date+'</strong>.<br>Each part rolls forward on its existing frequency.<br><span style="color:var(--ink-4);font-size:11.5px">Re-run anytime to change the anchor date.</span>';
    document.getElementById(pfx+'-success').style.display='block';
    document.getElementById(pfx+'-success').scrollIntoView({behavior:'smooth'});
    invalidateAdmin();
    toast('✅ '+r.updated+' parts scheduled!');
    st.preview=null;
  } catch (e) {
    btns.forEach(function(b){if(b){b.disabled=false;b.textContent='✓ Apply';}});
    toast(e.message,true);
  }
}

function schedReset(mode) {
  var pfx=mode==='line'?'sl':'sa';
  document.getElementById(pfx+'-line').value='';
  if(mode==='area'){document.getElementById('sa-area').innerHTML='<option value="">— Select Line first —</option>';document.getElementById('sa-area').disabled=true;}
  document.getElementById(pfx+'-date').value='';
  document.getElementById(pfx+'-scope').value='all';
  document.getElementById(pfx+'-preview').style.display='none';
  document.getElementById(pfx+'-success').style.display='none';
  var b=document.getElementById(pfx+'-prev-btn');if(b){b.disabled=false;b.textContent='👁 Preview';}
  _sched[mode]={preview:null,params:{}};
  var m=document.getElementById(mode==='line'?'sched-line-msg':'sched-area-msg');if(m)m.style.display='none';
}

// ============================================================
// ADMIN — Users
// ============================================================
function _buildAreaCBs(areas, lines, selectedIds) {
  var listEl=document.getElementById('u-area-list'); if(!listEl)return;
  if(!areas||!areas.length){listEl.innerHTML='<span style="font-size:11.5px;color:var(--ink-4);font-style:italic">No areas defined yet</span>';return;}
  var lm={};lines.forEach(function(l){lm[String(l.id)]=l.name;});
  var sel={};if(selectedIds)selectedIds.split(',').forEach(function(id){var t=id.trim();if(t)sel[t]=true;});
  listEl.innerHTML=areas.map(function(a){
    return '<label><input type="checkbox" value="'+a.id+'"'+(sel[String(a.id)]?' checked':'')+'>'+
      '<span><span style="color:var(--ink-4);font-size:10.5px">'+(lm[String(a.line_id)]||'')+' ›</span> <strong>'+a.name+'</strong></span></label>';
  }).join('');
}
function _getAreaIds(){var l=document.getElementById('u-area-list');if(!l)return '';var ids=[];l.querySelectorAll('input:checked').forEach(function(c){ids.push(c.value);});return ids.join(',');}

async function loadAdminUsers() {
  var d = await getAdminData();
  if(d&&d.success){
    S._uAreas=d.areas||[];S._uLines=d.lines||[];
    S._uAreaNameMap={};var lm={};
    (d.lines||[]).forEach(function(l){lm[String(l.id)]=l.name;});
    (d.areas||[]).forEach(function(a){S._uAreaNameMap[String(a.id)]=(lm[String(a.line_id)]||'')+' › '+a.name;});
    _buildAreaCBs(d.areas,d.lines,'');
  }
  try {
    var d2 = await adminGetUsers();
    var users=Array.isArray(d2)?d2:(d2&&d2.users?d2.users:[]);
    var t=document.getElementById('users-tbl');
    if(!users.length){t.innerHTML='<tr><td colspan="5" class="loading-r">No users yet.</td></tr>';return;}
    t.innerHTML=users.map(function(u){
      var rc={'admin':'rt-admin','manager':'rt-manager','technician':'rt-technician'}[u.role]||'';
      var aids=u.area_ids?String(u.area_ids).split(',').map(function(x){return x.trim();}).filter(Boolean):[];
      var al=aids.length?aids.map(function(id){var n=S._uAreaNameMap&&S._uAreaNameMap[id]?S._uAreaNameMap[id]:'Area '+id;return '<span style="background:var(--blue-l);color:var(--blue);padding:1px 7px;border-radius:10px;font-size:10.5px;font-weight:600;margin:1px;display:inline-block">'+n+'</span>';}).join(''):'<span style="color:var(--ink-4);font-size:12px">All areas</span>';
      return '<tr><td><strong>'+(u.username||'')+'</strong></td><td style="font-size:12px;color:var(--ink-3)">'+(u.email||'')+'</td>'+
        '<td><span class="role-tag '+rc+'">'+(u.role||'')+'</span></td>'+
        '<td style="max-width:240px">'+al+'</td>'+
        '<td><button class="btn btn-warn btn-sm" onclick="editUser(dec(\''+enc(u)+'\'))">Edit</button> '+
        '<button class="btn btn-danger btn-sm" onclick="deleteUser('+u.id+')">Delete</button></td></tr>';
    }).join('');
  } catch (e) { showErr('admin-error',e.message); }
}
function editUser(u){document.getElementById('user-id').value=u.id;document.getElementById('u-username').value=u.username||'';document.getElementById('u-email').value=u.email||'';document.getElementById('u-role').value=u.role||'technician';_buildAreaCBs(S._uAreas||[],S._uLines||[],u.area_ids||'');document.getElementById('user-form-title').textContent='Edit User';window.scrollTo(0,0);}
function resetUserForm(){document.getElementById('user-id').value='';document.getElementById('u-username').value='';document.getElementById('u-email').value='';document.getElementById('u-role').value='technician';_buildAreaCBs(S._uAreas||[],S._uLines||[],'');document.getElementById('user-form-title').textContent='Add New User';}
async function saveUser(){
  var email=document.getElementById('u-email').value.trim();
  if(!email){showMsg('user-msg','Email required',true);return;}
  try {
    var r = await adminSaveUser({id:document.getElementById('user-id').value||null,username:document.getElementById('u-username').value.trim(),email:email,role:document.getElementById('u-role').value,area_ids:_getAreaIds()});
    if(r&&r.success){showMsg('user-msg','Saved');resetUserForm();loadAdminUsers();}
    else showMsg('user-msg',r?r.error:'Failed',true);
  } catch (e) { showMsg('user-msg',e.message,true); }
}
async function deleteUser(id){if(!confirm('Delete user?'))return; await adminDeleteUser(id); loadAdminUsers();}
