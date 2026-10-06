// ============================================================
// AREA HISTORY — separate page (area-history.html)
// Uses the existing getLineHistoryFull() RPC for the area's line,
// then filters rows to the chosen area. No new SQL needed.
// ============================================================
var AREA_ORDER = ['mixing','divider','proofer','swing oven','depanner','cooler','slicer',
                  'tunnel oven','cooling conveyor','packing table','packing','cbb elevator'];

function areaRank(name) {
  var n = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  var best = 999, len = 0;
  AREA_ORDER.forEach(function (k, i) {
    if (n.indexOf(k) !== -1 && k.length > len) { best = i; len = k.length; } // longest match wins (packing table vs packing)
  });
  return best;
}

var PAGE = 50;
var _ah = { areas: [], lines: {}, cache: {}, rows: [], shown: 0, area: null };

function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
function toast(msg, isErr) {
  var t = document.getElementById('toast');
  t.textContent = msg; t.className = 'toast' + (isErr ? ' err' : ''); t.classList.add('show');
  setTimeout(function () { t.classList.remove('show'); }, 3000);
}
function showErr(msg) {
  var e = document.getElementById('ah-error');
  e.textContent = 'Error: ' + msg; e.style.display = 'block';
  setTimeout(function () { e.style.display = 'none'; }, 6000);
}
async function handleSignOut() {
  if (!confirm('Sign out?')) return;
  await sb.auth.signOut();
  window.location.href = 'login.html';
}
sb.auth.onAuthStateChange(function (ev) { if (ev === 'SIGNED_OUT') window.location.href = 'login.html'; });

window.onload = async function () {
  try {
    var r = await sb.auth.getSession();
    if (!r.data.session) { window.location.href = 'login.html'; return; }
    var u = await getCurrentUserRole();
    if (u.role === 'unauthorized' || u.role === 'technician') { window.location.href = 'index.html'; return; }
    document.getElementById('user-avatar').textContent = u.avatar;
    var rt = document.getElementById('role-tag');
    rt.textContent = u.role; rt.className = 'role-tag rt-' + u.role;
    document.getElementById('navbar').style.display = 'flex';

    var d = await getDashboardData('');
    if (!d || !d.success) { showErr(d ? d.error : 'Failed to load areas'); return; }
    (d.lines || []).forEach(function (l) { _ah.lines[String(l.id)] = l.name; });
    _ah.areas = (d.areas || []).slice().sort(function (a, b) {
      return areaRank(a.name) - areaRank(b.name) ||
        String(_ah.lines[String(a.line_id)] || '').localeCompare(String(_ah.lines[String(b.line_id)] || ''), undefined, { numeric: true });
    });
    var sel = document.getElementById('ah-sel');
    sel.innerHTML = '<option value="">— Select an Area —</option>';
    _ah.areas.forEach(function (a) {
      var o = document.createElement('option');
      o.value = a.id;
      o.textContent = (_ah.lines[String(a.line_id)] ? _ah.lines[String(a.line_id)] + ' › ' : '') + a.name;
      sel.appendChild(o);
    });
  } catch (e) { showErr(e.message); }
};

async function ahAreaChanged() {
  var id = document.getElementById('ah-sel').value;
  var panel = document.getElementById('ah-panel'), sum = document.getElementById('ah-summary');
  if (!id) { panel.style.display = 'none'; sum.style.display = 'none'; document.getElementById('ah-export').disabled = true; return; }
  var area = _ah.areas.filter(function (a) { return String(a.id) === String(id); })[0];
  _ah.area = area;
  panel.style.display = 'block';
  document.getElementById('ah-tbl').innerHTML = '<tr><td colspan="9" class="loading-r">Loading…</td></tr>';
  document.getElementById('ah-lm').style.display = 'none';
  document.getElementById('ah-count').textContent = '';
  try {
    var key = String(area.line_id);
    if (!_ah.cache[key]) {
      var d = await getLineHistoryFull(area.line_id);
      if (!d || !d.success) { showErr(d ? d.error : 'No data'); return; }
      _ah.cache[key] = d.history || [];
    }
    _ah.rows = _ah.cache[key].filter(function (h) { return h.area_name === area.name; });
    _ah.shown = 0;
    document.getElementById('ah-panel-title').textContent = area.name + ' — History';
    sum.style.display = 'block';
    sum.textContent = _ah.rows.length + ' total records for ' + area.name;
    document.getElementById('ah-export').disabled = !_ah.rows.length;
    document.getElementById('ah-tbl').innerHTML = '';
    if (!_ah.rows.length) {
      document.getElementById('ah-tbl').innerHTML = '<tr><td colspan="9" class="loading-r">No history for this area.</td></tr>';
      return;
    }
    ahRender();
  } catch (e) { showErr(e.message); }
}

function ahRender() {
  var next = _ah.rows.slice(_ah.shown, _ah.shown + PAGE);
  var html = next.map(function (h, i) {
    return '<tr><td>' + (_ah.shown + i + 1) + '</td><td>' + esc(h.line_name) + '</td><td>' + esc(h.area_name) + '</td><td>' + esc(h.equipment_name) + '</td>' +
      '<td><strong>' + esc(h.part_name || '-') + '</strong></td><td>' + esc(h.lubricated_on) + '</td>' +
      '<td style="font-size:11.5px;color:var(--ink-3)">' + esc(h.lubricated_by) + '</td>' +
      '<td>' + esc(h.frequency) + '</td><td>' + esc(h.next_due) + '</td></tr>';
  }).join('');
  document.getElementById('ah-tbl').insertAdjacentHTML('beforeend', html);
  _ah.shown += next.length;
  document.getElementById('ah-count').textContent = 'Showing ' + _ah.shown + ' of ' + _ah.rows.length;
  var more = _ah.rows.length - _ah.shown;
  document.getElementById('ah-lm').style.display = more > 0 ? 'block' : 'none';
  document.getElementById('ah-lm-info').textContent = more > 0 ? more + ' more' : '';
}
function ahLoadMore() { ahRender(); }

function ahExport() {
  if (!_ah.rows.length) { toast('Nothing to export', true); return; }
  var q = function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; };
  var rows = [['#','Line','Area','Equipment','Part','Lubricated On','By','Frequency','Next Due'].map(q).join(',')];
  _ah.rows.forEach(function (r, i) {
    rows.push([i + 1, r.line_name, r.area_name, r.equipment_name, r.part_name, r.lubricated_on, r.lubricated_by, r.frequency, r.next_due].map(q).join(','));
  });
  var blob = new Blob([rows.join('\n')], { type: 'text/csv' });
  var a = document.createElement('a');
  a.download = (_ah.area ? _ah.area.name : 'Area') + '_History.csv';
  a.href = URL.createObjectURL(blob); a.style.display = 'none';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  toast('Exported ' + _ah.rows.length + ' records');
}
