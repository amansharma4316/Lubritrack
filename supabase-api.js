// ============================================================
// LUBRICATION TRACKER — SUPABASE API LAYER
// Loaded after supabase-client.js and before app.js. Exposes the
// SAME function names the old Code.gs used (getDashboardData,
// markLubricated, adminSaveLine, etc.), but backed by Supabase
// instead of google.script.run. Login/auth itself lives in
// login.html + login.js (email + password) — this file assumes
// a session already exists.
// ============================================================

// ------------------------------------------------------------
// AUTH  (replaces getCurrentUserRole — reads the row that maps
// the logged-in Supabase Auth user to a role/area restriction)
// ------------------------------------------------------------
async function getCurrentUserRole() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return { email: 'unknown', role: 'unauthorized', name: 'Guest', avatar: '', area_ids: '' };

  const email = session.user.email;
  const { data: u, error } = await sb
    .from('app_users')
    .select('*')
    .ilike('email', email)
    .maybeSingle();

  const initial = email.charAt(0).toUpperCase();
  if (u && !error) {
    return {
      email, role: String(u.role).toLowerCase(), name: u.username,
      avatar: initial, area_ids: u.area_ids ? String(u.area_ids).trim() : ''
    };
  }
  return { email, role: 'unauthorized', name: 'Guest', avatar: initial, area_ids: '' };
}

// ------------------------------------------------------------
// MARK LUBRICATED  (RPC, transactional server-side)
// ------------------------------------------------------------
async function markLubricated(partId) {
  const { data, error } = await sb.rpc('mark_lubricated', { p_part_id: partId });
  if (error) return { success: false, error: error.message };
  return data;
}

// ------------------------------------------------------------
// DASHBOARD
// ------------------------------------------------------------
async function getDashboardData(_areaIdsStr) {
  // area filtering now happens server-side via RLS + current_app_area_ids()
  const { data, error } = await sb.rpc('get_dashboard_data');
  if (error) return { success: false, error: error.message };
  return data;
}

// ------------------------------------------------------------
// GLOBAL FILTERED PARTS  (paginated)
// ------------------------------------------------------------
async function getGlobalPartsFiltered(filter, page, pageSize, _areaIdsStr) {
  const { data, error } = await sb.rpc('get_global_parts_filtered', {
    p_filter: filter, p_page: page || 0, p_page_size: pageSize || 50
  });
  if (error) return { success: false, error: error.message };
  return data;
}

// ------------------------------------------------------------
// EQUIPMENT PAGE
// ------------------------------------------------------------
async function getEquipmentPageData(equipId, filter) {
  const { data, error } = await sb.rpc('get_equipment_page_data', {
    p_equip_id: equipId, p_filter: filter
  });
  if (error) return { success: false, error: error.message };
  return data;
}

// ------------------------------------------------------------
// EQUIPMENT / LINE HISTORY
// ------------------------------------------------------------
async function getEquipmentHistory(equipId, offset) {
  const { data, error } = await sb.rpc('get_equipment_history', {
    p_equip_id: equipId, p_offset: offset || 0
  });
  if (error) return { success: false, error: error.message };
  return data;
}

async function getEquipmentHistoryFull(equipId) {
  const { data, error } = await sb.rpc('get_equipment_history_full', { p_equip_id: equipId });
  if (error) return { success: false, error: error.message };
  return data;
}

async function getLineHistory(lineId, offset) {
  const { data, error } = await sb.rpc('get_line_history', {
    p_line_id: lineId, p_offset: offset || 0
  });
  if (error) return { success: false, error: error.message };
  return data;
}

async function getLineHistoryFull(lineId) {
  const { data, error } = await sb.rpc('get_line_history_full', { p_line_id: lineId });
  if (error) return { success: false, error: error.message };
  return data;
}

// ------------------------------------------------------------
// TECHNICIAN VIEW
// ------------------------------------------------------------
async function getTechnicianData() {
  const { data, error } = await sb.rpc('get_technician_data');
  if (error) return { success: false, error: error.message };
  return data;
}

// ------------------------------------------------------------
// ADMIN — batch read (mirrors adminGetAllData)
// ------------------------------------------------------------
async function adminGetAllData() {
  const [lines, areas, equipment, parts, users] = await Promise.all([
    sb.from('production_lines').select('*'),
    sb.from('areas').select('*'),
    sb.from('equipment').select('*'),
    sb.from('parts').select('*'),
    sb.from('app_users').select('*')
  ]);
  const err = lines.error || areas.error || equipment.error || parts.error || users.error;
  if (err) return { success: false, error: err.message };
  return {
    success: true,
    lines: lines.data, areas: areas.data, equipment: equipment.data,
    parts: parts.data, users: users.data
  };
}

async function adminGetUsers() {
  const { data, error } = await sb.from('app_users').select('*');
  if (error) return [];
  return data;
}

// ------------------------------------------------------------
// BULK SCHEDULE
// ------------------------------------------------------------
async function adminBulkSchedule(lineId, areaId, anchorDate, scope, previewOnly) {
  const { data, error } = await sb.rpc('admin_bulk_schedule', {
    p_line_id: lineId,
    p_area_id: areaId || null,
    p_anchor: anchorDate,
    p_scope: scope,
    p_preview: !!previewOnly
  });
  if (error) return { success: false, error: error.message };
  return data;
}

// ------------------------------------------------------------
// ADMIN CRUD — Lines
// ------------------------------------------------------------
async function adminSaveLine(data) {
  const payload = { name: data.name };
  const q = data.id
    ? sb.from('production_lines').update(payload).eq('id', data.id)
    : sb.from('production_lines').insert(payload);
  const { error } = await q;
  return error ? { success: false, error: error.message } : { success: true, message: data.id ? 'Line updated' : 'Line added' };
}
async function adminDeleteLine(id) {
  const { error } = await sb.from('production_lines').delete().eq('id', id);
  return error ? { success: false, error: error.message } : { success: true };
}

// ADMIN CRUD — Areas
async function adminSaveArea(data) {
  const payload = { name: data.name, line_id: data.line_id };
  const q = data.id
    ? sb.from('areas').update(payload).eq('id', data.id)
    : sb.from('areas').insert(payload);
  const { error } = await q;
  return error ? { success: false, error: error.message } : { success: true };
}
async function adminDeleteArea(id) {
  const { error } = await sb.from('areas').delete().eq('id', id);
  return error ? { success: false, error: error.message } : { success: true };
}

// ADMIN CRUD — Equipment  (+ optional "copy parts from" like the original)
async function adminSaveEquipment(data) {
  const payload = { name: data.name, code: data.code, area_id: data.area_id, line_id: data.line_id };
  let savedId = data.id;
  if (data.id) {
    const { error } = await sb.from('equipment').update(payload).eq('id', data.id);
    if (error) return { success: false, error: error.message };
  } else {
    const { data: inserted, error } = await sb.from('equipment').insert(payload).select().single();
    if (error) return { success: false, error: error.message };
    savedId = inserted.id;

    if (data.copy_from_equipment_id) {
      const { data: srcParts } = await sb
        .from('parts').select('*').eq('equipment_id', data.copy_from_equipment_id);
      if (srcParts && srcParts.length) {
        const copies = srcParts.map(p => ({
          name: p.name, equipment_id: savedId, lubricant_type: p.lubricant_type,
          frequency: p.frequency, next_due: p.next_due, lubricated: 'No'
        }));
        await sb.from('parts').insert(copies);
      }
    }
  }
  return { success: true };
}
async function adminDeleteEquipment(id) {
  const { error } = await sb.from('equipment').delete().eq('id', id);
  return error ? { success: false, error: error.message } : { success: true };
}

// ADMIN CRUD — Parts  (auto part code like the original EQ-01, EQ-02…)
async function adminSavePart(data) {
  if (data.id) {
    const { error } = await sb.from('parts').update({
      name: data.name, equipment_id: data.equipment_id, lubricant_type: data.lubricant_type,
      frequency: data.frequency, next_due: data.next_due, code: data.code
    }).eq('id', data.id);
    return error ? { success: false, error: error.message } : { success: true };
  }

  let code = data.code;
  if (!code) {
    const [{ data: eq }, { data: existing }] = await Promise.all([
      sb.from('equipment').select('code').eq('id', data.equipment_id).maybeSingle(),
      sb.from('parts').select('id').eq('equipment_id', data.equipment_id)
    ]);
    code = (eq?.code || 'EQ') + '-' + String((existing?.length || 0) + 1).padStart(2, '0');
  }
  const { error } = await sb.from('parts').insert({
    name: data.name, equipment_id: data.equipment_id, lubricant_type: data.lubricant_type,
    frequency: data.frequency, next_due: data.next_due, lubricated: 'No', code
  });
  return error ? { success: false, error: error.message } : { success: true };
}
async function adminDeletePart(id) {
  const { error } = await sb.from('parts').delete().eq('id', id);
  return error ? { success: false, error: error.message } : { success: true };
}

// ADMIN CRUD — Users
async function adminSaveUser(data) {
  const payload = { username: data.username, email: data.email, role: data.role, area_ids: data.area_ids || '' };
  const q = data.id
    ? sb.from('app_users').update(payload).eq('id', data.id)
    : sb.from('app_users').insert(payload);
  const { error } = await q;
  return error ? { success: false, error: error.message } : { success: true };
}
async function adminDeleteUser(id) {
  const { error } = await sb.from('app_users').delete().eq('id', id);
  return error ? { success: false, error: error.message } : { success: true };
}

// ============================================================
// TBM (TIME BASED MAINTENANCE) — same Supabase project/session,
// separate tables (tbm_equipment, tbm_tasks). See tbm_schema.sql.
// ============================================================

// ------------------------------------------------------------
// DASHBOARD + SCHEDULE
// ------------------------------------------------------------
async function getTBMDashboardData() {
  const { data, error } = await sb.rpc('get_tbm_dashboard_data');
  if (error) return { success: false, error: error.message };
  return data;
}

async function getTBMSchedule() {
  const { data, error } = await sb.rpc('get_tbm_full_schedule');
  if (error) return { success: false, error: error.message };
  return { success: true, tasks: data };
}

// ------------------------------------------------------------
// MARK DONE  (RPC, transactional server-side)
// ------------------------------------------------------------
async function markTBMDone(taskId, remarks) {
  const { data, error } = await sb.rpc('mark_tbm_done', { p_task_id: taskId, p_remarks: remarks || null });
  if (error) return { success: false, error: error.message };
  return data;
}

// ------------------------------------------------------------
// ADMIN CRUD — TBM Equipment
// ------------------------------------------------------------
async function adminGetTBMEquipment() {
  const { data, error } = await sb.from('tbm_equipment').select('*').order('name');
  if (error) return [];
  return data;
}
async function adminSaveTBMEquipment(data) {
  const payload = { name: data.name, code: data.code };
  const q = data.id
    ? sb.from('tbm_equipment').update(payload).eq('id', data.id)
    : sb.from('tbm_equipment').insert(payload);
  const { error } = await q;
  return error ? { success: false, error: error.message } : { success: true };
}
async function adminDeleteTBMEquipment(id) {
  const { error } = await sb.from('tbm_equipment').delete().eq('id', id);
  return error ? { success: false, error: error.message } : { success: true };
}

// ------------------------------------------------------------
// ADMIN CRUD — TBM Tasks  (auto code like TSK-01, TSK-02…)
// ------------------------------------------------------------
async function adminGetTBMTasks() {
  const { data, error } = await sb.from('tbm_tasks').select('*').order('name');
  if (error) return [];
  return data;
}
async function adminSaveTBMTask(data) {
  if (data.id) {
    const { error } = await sb.from('tbm_tasks').update({
      name: data.name, equipment_id: data.equipment_id, frequency: data.frequency,
      next_due: data.next_due, remarks: data.remarks, code: data.code
    }).eq('id', data.id);
    return error ? { success: false, error: error.message } : { success: true };
  }

  let code = data.code;
  if (!code) {
    const { data: existing } = await sb.from('tbm_tasks').select('id').eq('equipment_id', data.equipment_id);
    code = 'TSK-' + String((existing?.length || 0) + 1).padStart(2, '0');
  }
  const { error } = await sb.from('tbm_tasks').insert({
    name: data.name, equipment_id: data.equipment_id, frequency: data.frequency,
    next_due: data.next_due, remarks: data.remarks || null, done: 'No', code
  });
  return error ? { success: false, error: error.message } : { success: true };
}
async function adminDeleteTBMTask(id) {
  const { error } = await sb.from('tbm_tasks').delete().eq('id', id);
  return error ? { success: false, error: error.message } : { success: true };
}
