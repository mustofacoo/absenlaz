// ===================================================
// supabase.js — Konfigurasi & semua operasi database
// ===================================================

// ⚠️ GANTI kedua nilai ini dengan milik Anda dari:
// Supabase Dashboard → Settings → API
const SUPABASE_URL = 'https://itoanuqonbjpjxiarcio.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml0b2FudXFvbmJqcGp4aWFyY2lvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg0MTk0ODEsImV4cCI6MjEwMzk5NTQ4MX0.D8NsUp0KJKSvT7h-JtGgitReOfkeIeT85syy3kGFaXU';

const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ===================================================
// USERS
// ===================================================

async function sbGetUsers() {
  const { data, error } = await sb.from('users').select('*').order('name');
  if (error) { console.error('sbGetUsers:', error.message); return []; }
  return data;
}

async function sbAddUser(name, password, role = 'employee') {
  const { data, error } = await sb.from('users').insert({
    name,
    password, // ⚠️ plain text — enkripsi di backend nanti
    role
  }).select().single();
  if (error) throw error;
  return data;
}

async function sbUpdateUser(id, name, password) {
  const { error } = await sb.from('users').update({ name, password }).eq('id', id);
  if (error) throw error;
}

async function sbDeleteUser(id) {
  const { error } = await sb.from('users').delete().eq('id', id);
  if (error) throw error;
}

// ===================================================
// ATTENDANCE
// ===================================================

async function sbGetAttendance(monthStr) {
  // monthStr format: 'YYYY-MM'
  const from = `${monthStr}-01`;
  const [y, m] = monthStr.split('-');
  const lastDay = new Date(parseInt(y), parseInt(m), 0).getDate();
  const to = `${monthStr}-${String(lastDay).padStart(2, '0')}`;

  const { data, error } = await sb.from('attendance')
    .select('*')
    .gte('date', from)
    .lte('date', to);
  if (error) { console.error('sbGetAttendance:', error.message); return []; }
  return data;
}

async function sbGetTodayAttendance(dateStr) {
  const { data, error } = await sb.from('attendance')
    .select('*')
    .eq('date', dateStr);
  if (error) { console.error('sbGetTodayAttendance:', error.message); return []; }
  return data;
}

async function sbInsertAttendance(att) {
  const { data, error } = await sb.from('attendance').insert(att).select().single();
  if (error) throw error;
  return data;
}

async function sbUpdateAttendance(id, fields) {
  const { error } = await sb.from('attendance').update(fields).eq('id', id);
  if (error) throw error;
}

async function sbUpsertAttendance(att) {
  // Dipakai untuk edit absensi oleh admin (update kalau sudah ada, insert kalau belum)
  const { data, error } = await sb.from('attendance')
    .upsert(att, { onConflict: 'user_id,date' })
    .select().single();
  if (error) throw error;
  return data;
}