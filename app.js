const { createApp, ref, reactive, computed, onMounted, onUnmounted } = Vue;

// ===== HELPERS (tidak berubah) =====
const SESSION_KEY = 'absenku_session';

function getToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function getTime() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

function isWeekend(dateStr) {
  const d = new Date(dateStr);
  return d.getDay() === 0 || d.getDay() === 6;
}

function getDaysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

const OFFICE_LOCATION = {
  lat: -8.162822992604427,
  lng: 113.70746537279484,
  radius: 100
};

function getDistanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng/2) * Math.sin(dLng/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ===== APP =====
createApp({
  setup() {

    // ----- STATE -----
    const db = reactive({ users: [], attendance: [] });
    const isLoading = ref(true); // loading awal saat fetch dari Supabase
    const currentUser = ref(null);
    const currentTime = ref(getTime());
    const today = ref(getToday());
    const loginForm = reactive({ userId: '', password: '' });
    const loginError = ref('');
    const showPass = ref(false);
    const adminTab = ref('dashboard');
    const userTab = ref('home');
    const toast = reactive({ show: false, msg: '', type: 'success' });
    const showUserModal = ref(false);
    const showAttModal = ref(false);
    const editingUser = ref(null);
    const editingAtt = ref({});
    const userForm = reactive({ name: '', password: '' });
    const attForm = reactive({ status: '', check_in: '', check_out: '', note: '' });
    const formError = ref('');
    const reportFilter = reactive({
      month: `${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}`,
      userId: ''
    });
    const historyMonth = ref(`${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}`);
    const absenForm = reactive({ status: '', check_in: getTime(), note: '' });
    const geoStatus = ref('idle');
    const geoMessage = ref('');
    const showCheckOutModal = ref(false);
    const checkOutTime = ref('');
    const showTodayAttendance = ref(false); // toggle: buka/tutup daftar "Sudah Absen Hari Ini"
    let timer = null;

    // ----- LOAD DATA DARI SUPABASE -----
    async function loadInitialData() {
      isLoading.value = true;
      try {
        // Ambil semua user
        const users = await sbGetUsers();
      db.users = users.slice().sort((a, b) => a.name.localeCompare(b.name, 'id'));
        // Ambil absensi bulan ini + bulan lalu (untuk hasUnfinishedCheckout)
        const now = new Date();
        const thisMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
        const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth()+1).padStart(2,'0')}`;

        const [thisAtt, prevAtt] = await Promise.all([
          sbGetAttendance(thisMonth),
          sbGetAttendance(prevMonth),
        ]);
        db.attendance = [...prevAtt, ...thisAtt];
      } catch (e) {
        console.error('loadInitialData error:', e);
        showToast('Gagal memuat data dari server', 'error');
      } finally {
        isLoading.value = false;
      }
    }

    // Reload absensi untuk bulan tertentu (dipakai saat filter rekap berubah)
    async function loadAttendanceForMonth(monthStr) {
      try {
        const newAtts = await sbGetAttendance(monthStr);
        // Hapus data bulan itu dari db.attendance lalu masukkan yang baru
        db.attendance = db.attendance.filter(a => !a.date.startsWith(monthStr));
        db.attendance.push(...newAtts);
      } catch (e) {
        showToast('Gagal memuat rekap', 'error');
      }
    }

    // ----- MOUNTED -----
    onMounted(async () => {
      await loadInitialData();

      // Cek session
      const sess = localStorage.getItem(SESSION_KEY);
      if (sess) {
        const user = db.users.find(u => u.id === sess);
        if (user) currentUser.value = user;
      }

      timer = setInterval(() => {
        currentTime.value = getTime();
        today.value = getToday();
      }, 1000);
    });
    onUnmounted(() => clearInterval(timer));

    // ----- COMPUTED (tidak berubah dari versi lama) -----
    const todayFormatted = computed(() => {
      const d = new Date();
      const days = ['Ahad','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
      const months = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Ags','Sep','Okt','Nov','Des'];
      return `${days[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
    });

    const greeting = computed(() => {
      const h = new Date().getHours();
      if (h < 18) return 'Assalamualaikum';
      return 'Ngapain buka absen malam-malam? hehe';
    });

    const employeeUsers = computed(() => db.users.filter(u => u.role !== 'admin'));

    const adminTabs = [
      { id: 'dashboard', label: 'Dashboard' },
      { id: 'users', label: 'Mujahid' },
      { id: 'report', label: 'Rekap' },
    ];
    const userTabs = [
      { id: 'home', label: 'Beranda' },
      { id: 'riwayat', label: 'Riwayat' },
    ];
    const attendanceStatuses = [
      { value: 'hadir',      label: 'Hadir', color: '#059669', desc: 'Masuk kerja hari ini' },
      { value: 'izin',       label: 'Izin', color: '#D97706', desc: 'Izin dengan alasan' },
      { value: 'sakit',      label: 'Sakit', color: '#DC2626', desc: 'Tidak masuk karena sakit' },
      { value: 'tugas_luar', label: 'Tugas Luar', color: '#1249c9', desc: 'Dinas atau tugas lapangan' },
    ];

const months = computed(() => {
  const now = new Date();
  const result = [];
  for (let i = 5; i >= -1; i--) {
    const d    = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const prev = new Date(d.getFullYear(), d.getMonth() - 1, 21);
    const val  = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    const namaBulan = d.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
    const prevLabel = prev.toLocaleDateString('id-ID', { day:'numeric', month:'short' });
    const endLabel  = new Date(d.getFullYear(), d.getMonth(), 20)
                        .toLocaleDateString('id-ID', { day:'numeric', month:'short' });
    const label = `${namaBulan} (${prevLabel} – ${endLabel})`;
    result.push({ value: val, label });
  }
  return result;
});

    const todayAttendanceList = computed(() =>
      db.attendance.filter(a => a.date === today.value)
    );
    const todayMyAttendance = computed(() =>
      currentUser.value ? db.attendance.find(a => a.user_id === currentUser.value.id && a.date === today.value) : null
    );
    const canCheckOut = computed(() => {
      const a = todayMyAttendance.value;
      return a && a.status === 'hadir' && a.check_in && !a.check_out;
    });

    const hasUnfinishedCheckout = computed(() => {
      if (!currentUser.value) return false;
      const now = new Date();
      for (let i = 1; i <= 7; i++) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        if (d.getDay() === 0 || d.getDay() === 6) continue;
        const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        const att = db.attendance.find(a => a.user_id === currentUser.value.id && a.date === dateStr);
        if (att && att.status === 'hadir' && att.check_in && !att.check_out) return true;
        if (att) return false;
      }
      return false;
    });

    // Computed: ambil data absen yang belum checkout (untuk tombol di Beranda)
    const unfinishedAttendance = computed(() => {
      if (!currentUser.value) return null;
      const now = new Date();
      for (let i = 1; i <= 7; i++) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        if (d.getDay() === 0 || d.getDay() === 6) continue;
        const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        const att = db.attendance.find(a => a.user_id === currentUser.value.id && a.date === dateStr);
        if (att && att.status === 'hadir' && att.check_in && !att.check_out) return att;
        if (att) return null;
      }
      return null;
    });

    // SESUDAH
    const todayStats = computed(() => {
      const emps = employeeUsers.value;
      const todayAtts = todayAttendanceList.value;
      const hadir      = todayAtts.filter(a => a.status === 'hadir').length;
      const izin       = todayAtts.filter(a => a.status === 'izin').length;
      const sakit      = todayAtts.filter(a => a.status === 'sakit').length;
      const dinasLuar  = todayAtts.filter(a => a.status === 'tugas_luar').length;
      const alpha      = isWeekend(today.value) ? 0 : Math.max(0, emps.length - todayAtts.length);
      return [
        { label: 'Hadir',      value: hadir,         color: '#059669' },
        { label: 'Izin/Sakit', value: izin + sakit,  color: '#D97706' },
        { label: 'Alpha',      value: alpha,          color: '#DC2626' },
        { label: 'Dinas Luar', value: dinasLuar,      color: '#1A56DB' },
      ];
    });

const filteredReport = computed(() => {
  if (!reportFilter.month) return [];

  // Hitung rentang: 21 bulan sebelumnya s/d 20 bulan ini
  const [fy, fm] = reportFilter.month.split('-').map(Number);
  const startDate = new Date(fy, fm - 2, 21); // tgl 21 bulan sebelumnya
  const endDate   = new Date(fy, fm - 1, 20); // tgl 20 bulan ini
  const today     = new Date();
  const cap       = endDate < today ? endDate : today; // jangan lewati hari ini

  const result = [];
  const users = reportFilter.userId
    ? db.users.filter(u => u.id === reportFilter.userId)
    : employeeUsers.value;

  const attendanceLookup = {};
  db.attendance.forEach(rec => { attendanceLookup[`${rec.user_id}_${rec.date}`] = rec; });

  for (const user of users) {
    const cur = new Date(startDate);
    while (cur <= cap) {
      const dateStr = `${cur.getFullYear()}-${String(cur.getMonth()+1).padStart(2,'0')}-${String(cur.getDate()).padStart(2,'0')}`;
      if (!isWeekend(dateStr)) {
        const att = attendanceLookup[`${user.id}_${dateStr}`];
        const status = att ? att.status : 'alpha';
        const arrivalCat = (att && att.status === 'hadir') ? getArrivalCategory(att.check_in) : null;
        result.push({
          key:        `${user.id}_${dateStr}`,
          user_id:    user.id,
          name:       user.name,
          date:       dateStr,
          dateDisplay: new Date(dateStr).toLocaleDateString('id-ID', { day:'numeric', month:'short' }),
          status,
          check_in:   att?.check_in  || '',
          check_out:  att?.check_out || '',
          note:       att?.note      || '',
          supabase_id: att?.id || null,
          arrivalCat,
        });
      }
      cur.setDate(cur.getDate() + 1);
    }
  }
  return result.reverse();
});

    const reportSummary = computed(() => {
      const rows = filteredReport.value;
      const hadir     = rows.filter(r => r.status === 'hadir').length;
      const izin      = rows.filter(r => r.status === 'izin').length;
      const sakit     = rows.filter(r => r.status === 'sakit').length;
      const tugas     = rows.filter(r => r.status === 'tugas_luar').length;
      const alpha     = rows.filter(r => r.status === 'alpha').length;
      const hadirRows = rows.filter(r => r.status === 'hadir');
      const tepat      = hadirRows.filter(r => r.arrivalCat?.key === 'tepat_waktu').length;

      const terlambatS = hadirRows.filter(r => r.arrivalCat?.key === 'terlambat_sedang').length;
      const terlambatB = hadirRows.filter(r => r.arrivalCat?.key === 'terlambat_berat').length;
      return [
      
        { label: 'Tepat Waktu',                      value: tepat,       color: '#059669' },
        { label: 'Terlambat Sedang (08.01-08.30)',    value: terlambatS,  color: '#EA580C' },
        { label: 'Terlambat Berat (08.30+)',          value: terlambatB,  color: '#DC2626' },
        { label: 'Izin',   value: izin,   color: '#D97706' },
        { label: 'Sakit',  value: sakit,  color: '#EF4444' },
        { label: 'Tugas',  value: tugas,  color: '#7C3AED' },
        { label: 'Alpha',  value: alpha,  color: '#DC2626' },

      ];
    });

    const myHistory = computed(() => {
      if (!currentUser.value) return [];
      const [hy, hm] = historyMonth.value.split('-').map(Number);
      const startDate = new Date(hy, hm - 2, 21); // tgl 21 bulan sebelumnya
      const endDate   = new Date(hy, hm - 1, 20); // tgl 20 bulan ini
      const today     = new Date();
      const cap       = endDate < today ? endDate : today;
      const result    = [];
      const cur = new Date(startDate);
      while (cur <= cap) {
        const dateStr = `${cur.getFullYear()}-${String(cur.getMonth()+1).padStart(2,'0')}-${String(cur.getDate()).padStart(2,'0')}`;
        if (isWeekend(dateStr)) {
          result.push({ date: dateStr, status: 'libur', check_in: '', check_out: '', note: '' });
        } else {
          const att = db.attendance.find(a => a.user_id === currentUser.value.id && a.date === dateStr);
          result.push(att || { date: dateStr, status: 'alpha', check_in: '', check_out: '', note: '' });
        }
        cur.setDate(cur.getDate() + 1);
      }
      return result.reverse();
    });

    const myMonthStats = computed(() => {
      if (!currentUser.value) return [];
      const [hy, hm] = historyMonth.value.split('-').map(Number);
      const startDate = new Date(hy, hm - 2, 21);
      const endDate   = new Date(hy, hm - 1, 20);
      const today     = new Date();
      const cap       = endDate < today ? endDate : today;
      let hadir=0,izin=0,sakit=0,alpha=0,tugas=0,tepat=0,terlambatS=0,terlambatB=0;
      const cur = new Date(startDate);
      while (cur <= cap) {
        const dateStr = `${cur.getFullYear()}-${String(cur.getMonth()+1).padStart(2,'0')}-${String(cur.getDate()).padStart(2,'0')}`;
        if (!isWeekend(dateStr)) {
          const att = db.attendance.find(a => a.user_id === currentUser.value.id && a.date === dateStr);
          const s = att ? att.status : 'alpha';
          if (s==='hadir') {
            hadir++;
            const cat = getArrivalCategory(att.check_in);
            if (cat?.key === 'tepat_waktu')           tepat++;
           
            else if (cat?.key === 'terlambat_sedang') terlambatS++;
            else if (cat?.key === 'terlambat_berat')  terlambatB++;
          }
          else if (s==='izin')       izin++;
          else if (s==='sakit')      sakit++;
          else if (s==='tugas_luar') tugas++;
          else if (s==='alpha')      alpha++;
        }
        cur.setDate(cur.getDate() + 1);
      }
      return [
        { label: 'Tepat Waktu',      value: tepat,       color: '#059669' },
        { label: 'Terlambat Sedang', value: terlambatS,  color: '#EA580C' },
        { label: 'Terlambat Berat',  value: terlambatB,  color: '#DC2626' },
        { label: 'Izin',             value: izin,        color: '#D97706' },
        { label: 'Sakit',            value: sakit,       color: '#EF4444' },
        { label: 'Tugas Luar',       value: tugas,       color: '#7C3AED' },
        { label: 'Alpha',            value: alpha,       color: '#DC2626' },

      ];
    });

    // ----- METHODS -----

    function showToast(msg, type='success') {
      toast.msg = msg; toast.type = type; toast.show = true;
      setTimeout(() => { toast.show = false; }, 2500);
    }

    function login() {
      loginError.value = '';
      const uid  = loginForm.userId;
      const pass = loginForm.password;
      if (!uid || !pass) { loginError.value = 'Pilih nama dan masukkan password'; return; }
      const user = db.users.find(u => u.id === uid && u.password === pass);
      if (!user) { loginError.value = 'Password salah'; return; }
      currentUser.value = user;
      localStorage.setItem(SESSION_KEY, user.id);
      loginForm.userId = ''; loginForm.password = '';
    }

    function logout() {
      currentUser.value = null;
      localStorage.removeItem(SESSION_KEY);
      adminTab.value = 'dashboard';
      userTab.value  = 'home';
    }

    async function submitAbsen() {
      if (!absenForm.status) return;
      if (hasUnfinishedCheckout.value) {
        showToast('Selesaikan absen pulang kemarin terlebih dahulu', 'error'); return;
      }
      if (absenForm.status !== 'hadir' && !absenForm.note) {
        showToast('Isi keterangan terlebih dahulu', 'error'); return;
      }

      // Izin / sakit / tugas_luar → simpan langsung tanpa GPS
      if (absenForm.status !== 'hadir') {
        try {
          const att = {
            user_id:   currentUser.value.id,
            date:      today.value,
            status:    absenForm.status,
            check_in:  '',
            check_out: '',
            note:      absenForm.note
          };
          const saved = await sbInsertAttendance(att);
          db.attendance.push(saved);
          absenForm.status = ''; absenForm.note = '';
          showToast('✅ Absensi berhasil dicatat!');
          userTab.value = 'home';
        } catch (e) {
          showToast('Gagal menyimpan absensi: ' + e.message, 'error');
        }
        return;
      }

      // Hadir → wajib GPS
      if (!navigator.geolocation) {
        showToast('Browser tidak mendukung GPS', 'error'); return;
      }
      geoStatus.value  = 'bentar...';
      geoMessage.value = 'Anda dimana ya...';

      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const dist = getDistanceMeters(
            pos.coords.latitude, pos.coords.longitude,
            OFFICE_LOCATION.lat, OFFICE_LOCATION.lng
          );
          if (dist <= OFFICE_LOCATION.radius) {
            try {
              const checkInTime = getTime();
              const att = {
                user_id:   currentUser.value.id,
                date:      today.value,
                status:    'hadir',
                check_in:  checkInTime,
                check_out: '',
                note:      '',
                geo_lat:   pos.coords.latitude,
                geo_lng:   pos.coords.longitude
              };
              const saved = await sbInsertAttendance(att);
              db.attendance.push(saved);
              absenForm.status = '';
              geoStatus.value  = 'idle';
              showToast(`✅ Absen masuk pukul ${checkInTime}`);
              userTab.value = 'home';
            } catch (e) {
              geoStatus.value = 'failed';
              geoMessage.value = 'Gagal menyimpan ke server: ' + e.message;
            }
          } else {
            geoStatus.value  = 'failed';
            geoMessage.value = 'Apa GPS/Akses lokasi antum aktif? Apa antum ada di sekitar kantor?';
          }
        },
        (err) => {
          geoStatus.value  = 'denied';
          geoMessage.value = err.code === 1
            ? 'Izin lokasi ditolak. Aktifkan GPS di pengaturan.'
            : 'Gagal mendapatkan lokasi. Coba lagi.';
        },
        { timeout: 10000, maximumAge: 0, enableHighAccuracy: true }
      );
    }

    function openCheckOut() {
      checkOutTime.value   = getTime();
      showCheckOutModal.value = true;
    }

    // BARU — ganti dengan ini
    async function confirmCheckOut() {
      if (!checkOutTime.value) {
        showToast('Isi jam pulang terlebih dahulu', 'error'); return;
      }
      // Cari absen hari ini ATAU absen kemarin yang belum selesai
      const att = db.attendance.find(a => a.user_id === currentUser.value.id && a.date === today.value)
              || unfinishedAttendance.value;
      if (!att) return;
      try {
        await sbUpdateAttendance(att.id, { check_out: checkOutTime.value });
        att.check_out = checkOutTime.value;
        showCheckOutModal.value = false;
        showToast('Absen pulang berhasil!');
      } catch (e) {
        showToast('Gagal menyimpan: ' + e.message, 'error');
      }
    }

    function getUserName(uid) {
      const u = db.users.find(u => u.id === uid);
      return u ? u.name : 'Unknown';
    }

    function getMonthlyStats(uid) {
      const now = new Date();
      const y = now.getFullYear(), m = String(now.getMonth()+1).padStart(2,'0');
      const days = getDaysInMonth(now.getFullYear(), now.getMonth()+1);
      let hadir = 0;
      for (let d = 1; d <= days; d++) {
        const ds = `${y}-${m}-${String(d).padStart(2,'0')}`;
        if (new Date(ds) > now || isWeekend(ds)) continue;
        const a = db.attendance.find(a => a.user_id === uid && a.date === ds);
        if (a && a.status === 'hadir') hadir++;
      }
      return `Hadir ${hadir} hari bulan ini`;
    }

    function openAddUser() {
      editingUser.value = null;
      userForm.name = ''; userForm.password = ''; formError.value = '';
      showUserModal.value = true;
    }
    function openEditUser(user) {
      editingUser.value = user;
      userForm.name = user.name; userForm.password = user.password; formError.value = '';
      showUserModal.value = true;
    }

    async function saveUser() {
      formError.value = '';
      if (!userForm.name.trim())     { formError.value = 'Nama wajib diisi';     return; }
      if (!userForm.password.trim()) { formError.value = 'Password wajib diisi'; return; }
      try {
        if (!editingUser.value) {
          const exists = db.users.find(u => u.name.toLowerCase() === userForm.name.toLowerCase());
          if (exists) { formError.value = 'Nama sudah terdaftar'; return; }
          const newUser = await sbAddUser(userForm.name.trim(), userForm.password);
          db.users.push(newUser);
          db.users.sort((a, b) => a.name.localeCompare(b.name, 'id'));
        } else {
          await sbUpdateUser(editingUser.value.id, userForm.name.trim(), userForm.password);
          const user = db.users.find(u => u.id === editingUser.value.id);
          if (user) { user.name = userForm.name.trim(); user.password = userForm.password; }
        }
        showUserModal.value = false;
        showToast(editingUser.value ? 'Data Mujahid diperbarui' : 'Mujahid berhasil ditambahkan');
      } catch (e) {
        formError.value = 'Gagal menyimpan: ' + e.message;
      }
    }

    async function deleteUser(uid) {
      if (!confirm('Hapus Mujahid ini?')) return;
      try {
        await sbDeleteUser(uid);
        const idx = db.users.findIndex(u => u.id === uid);
        if (idx > -1) db.users.splice(idx, 1);
        showToast('Mujahid dihapus');
      } catch (e) {
        showToast('Gagal menghapus: ' + e.message, 'error');
      }
    }

    function openEditAttendance(row) {
      editingAtt.value  = row;
      attForm.status    = row.status;
      attForm.check_in  = row.check_in;
      attForm.check_out = row.check_out;
      attForm.note      = row.note;
      showAttModal.value = true;
    }

    async function saveAttendance() {
      try {
        const payload = {
          user_id:   editingAtt.value.user_id,
          date:      editingAtt.value.date,
          status:    attForm.status,
          check_in:  attForm.check_in,
          check_out: attForm.check_out,
          note:      attForm.note,
        };
        // Kalau sudah ada di Supabase, tambahkan id-nya agar upsert update, bukan insert baru
        if (editingAtt.value.supabase_id) payload.id = editingAtt.value.supabase_id;

        const saved = await sbUpsertAttendance(payload);

        // Update lokal
        const idx = db.attendance.findIndex(a =>
          a.user_id === editingAtt.value.user_id && a.date === editingAtt.value.date
        );
        if (idx > -1) db.attendance[idx] = saved;
        else db.attendance.push(saved);

        showAttModal.value = false;
        showToast('Absensi berhasil diperbarui');
      } catch (e) {
        showToast('Gagal menyimpan: ' + e.message, 'error');
      }
    }

    // ===== EXPORT CSV REKAP =====
    // Escape field CSV agar aman kalau keterangan mengandung koma, kutip, atau baris baru
    function csvEscape(val) {
      const s = String(val ?? '');
      if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
      return s;
    }

function exportCSV() {
  const [fy, fm] = reportFilter.month.split('-').map(Number);
  const startDate = new Date(fy, fm - 2, 21);
  const endDate   = new Date(fy, fm - 1, 20);
  const today2    = new Date();
  const cap       = endDate < today2 ? endDate : today2;

  const users = reportFilter.userId
    ? db.users.filter(u => u.id === reportFilter.userId)
    : employeeUsers.value;

  const attendanceLookup = {};
  db.attendance.forEach(rec => { attendanceLookup[`${rec.user_id}_${rec.date}`] = rec; });

  const rows = [];
  // Header
  rows.push([
    'Nama',
    'Total Hadir',
    'Tepat Waktu',
  
    'Terlambat Sedang',
    'Terlambat Berat',
    'Sakit',
    'Izin',
    'Dinas Luar',
    'Alpha',
    'Keterangan Sakit',
    'Keterangan Izin',
    'Keterangan Tugas Luar'
  ]);

  for (const user of users) {
    let hadir=0, tepat=0, terlambatR=0, terlambatS=0, terlambatB=0;
    let sakit=0, izin=0, tugas=0, alpha=0;
    const ketSakit = [], ketIzin = [], ketTugas = [];

    const cur = new Date(startDate);
    while (cur <= cap) {
      const dateStr = `${cur.getFullYear()}-${String(cur.getMonth()+1).padStart(2,'0')}-${String(cur.getDate()).padStart(2,'0')}`;
      if (!isWeekend(dateStr)) {
        const att = attendanceLookup[`${user.id}_${dateStr}`];
        const s = att ? att.status : 'alpha';
        const tgl = new Date(dateStr).toLocaleDateString('id-ID', { day:'numeric', month:'short' });
        if (s === 'hadir') {
          hadir++;
          const cat = getArrivalCategory(att.check_in);
          if      (cat?.key === 'tepat_waktu')       tepat++;
          else if (cat?.key === 'terlambat_ringan')  terlambatR++;
          else if (cat?.key === 'terlambat_sedang')  terlambatS++;
          else if (cat?.key === 'terlambat_berat')   terlambatB++;
        }
        else if (s === 'sakit')      { sakit++;  if (att?.note) ketSakit.push(`${tgl}: ${att.note}`); }
        else if (s === 'izin')       { izin++;   if (att?.note) ketIzin.push(`${tgl}: ${att.note}`); }
        else if (s === 'tugas_luar') { tugas++;  if (att?.note) ketTugas.push(`${tgl}: ${att.note}`); }
        else if (s === 'alpha')      alpha++;
      }
      cur.setDate(cur.getDate() + 1);
    }

    rows.push([
      user.name,
      hadir,
      tepat,
  
      terlambatS,
      terlambatB,
      sakit,
      izin,
      tugas,
      alpha,
      ketSakit.join(' | '),
      ketIzin.join(' | '),
      ketTugas.join(' | ')
    ]);
  }

  // Buat konten CSV (setiap field di-escape agar aman dari koma/kutip pada keterangan)
  const csvContent = rows.map(r => r.map(csvEscape).join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');

  // Nama file: rekap-BULAN-TAHUN.csv
  const bulan = new Date(fy, fm - 1, 1)
    .toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })
    .replace(/ /g, '-');
  a.href     = url;
  a.download = `rekap-${bulan}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

    function statusLabel(s) {
      return { hadir:'Hadir', izin:'Izin', sakit:'Sakit', tugas_luar:'Tugas Luar', alpha:'Alpha', libur:'Libur' }[s] || s;
    }
    function statusColor(s) {
      return { hadir:'#059669', izin:'#D97706', sakit:'#EF4444', tugas_luar:'#7C3AED', alpha:'#DC2626', libur:'#9CA3AF' }[s] || '#6B7280';
    }
    function getDayName(dateStr) {
      return ['Min','Sen','Sel','Rab','Kam','Jum','Sab'][new Date(dateStr).getDay()];
    }
    function getArrivalCategory(checkIn) {
      if (!checkIn) return null;
      const [h, m] = checkIn.split(':').map(Number);
      const t = h * 60 + m;
// SESUDAH
if (t <= 480)  return { key: 'tepat_waktu',     label: 'Tepat Waktu',     color: '#059669', bg: '#D1FAE5' };
if (t <= 510)  return { key: 'terlambat_sedang', label: 'Terlambat Sedang', color: '#EA580C', bg: '#FFEDD5' };
return           { key: 'terlambat_berat',  label: 'Terlambat Berat',  color: '#DC2626', bg: '#FEE2E2' };
    }

    // Ketika bulan rekap berubah, muat data bulan itu dari Supabase
    // (dipanggil dari watcher di bawah)
      async function onReportMonthChange(newMonth) {
        const [fy, fm] = newMonth.split('-').map(Number);
        // Perlu data bulan sebelumnya juga (untuk tgl 26–akhir bulan lalu)
        const prevDate  = new Date(fy, fm - 2, 1);
        const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth()+1).padStart(2,'0')}`;
        await Promise.all([
          loadAttendanceForMonth(newMonth),
          loadAttendanceForMonth(prevMonth),
        ]);
      }
      async function onHistoryMonthChange(newMonth) {
        const [fy, fm] = newMonth.split('-').map(Number);
        const prevDate  = new Date(fy, fm - 2, 1);
        const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth()+1).padStart(2,'0')}`;
        await Promise.all([
          loadAttendanceForMonth(newMonth),
          loadAttendanceForMonth(prevMonth),
        ]);
      }


    // Vue watch — pantau perubahan filter bulan
    const { watch } = Vue;
    watch(() => reportFilter.month,  onReportMonthChange);
    watch(historyMonth,              onHistoryMonthChange);

    return {
      db, isLoading,
      currentUser, currentTime, loginForm, loginError, showPass,
      adminTab, userTab, adminTabs, userTabs, attendanceStatuses,
      toast, showUserModal, showAttModal, editingUser, editingAtt,
      userForm, attForm, formError, reportFilter, historyMonth, absenForm,
      months, today, todayFormatted, greeting,
      employeeUsers, todayAttendanceList, todayMyAttendance, canCheckOut, hasUnfinishedCheckout, unfinishedAttendance,
      showCheckOutModal, checkOutTime, showTodayAttendance,
      todayStats, filteredReport, reportSummary, myHistory, myMonthStats,
      geoStatus, geoMessage,
      login, logout, submitAbsen, openCheckOut, confirmCheckOut,
      getUserName, getMonthlyStats, openAddUser, openEditUser, saveUser, deleteUser,
      openEditAttendance, saveAttendance,
      statusLabel, statusColor, getDayName, getArrivalCategory, exportCSV
    };
  }
}).mount('#app');
