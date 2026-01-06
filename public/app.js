/* =======================================
   Global state (prototype + login info)
======================================= */
const API_BASE = '/api';

function getAuthHeaders() {
  const token = localStorage.getItem('fa_token');
  return {
    'Content-Type': 'application/json',
    'Authorization': token ? `Bearer ${token}` : ''
  };
}
async function loadStudentsFromApi() {
  try {
    const res = await fetch(`${API_BASE}/teacher/students`, {
      method: 'GET',
      headers: getAuthHeaders()
    });

    const data = await res.json();
    if (!res.ok) {
      console.error('load students error:', data.error);
      return;
    }

    // map ให้เข้ากับโครงเดิมของ state.students ที่ใช้ใน renderStudents()
    state.students = data.students.map(row => ({
      db_id: row.student_id,
      student_id: row.student_code,
      name: row.full_name,
      class: row.year_level,   // ← ใช้คอลัมน์ใหม่จาก DB
      fingerprint_id: row.fingerprint_id
    }));


    renderStudents();
    renderStudentSummary();   // ถ้าอยากอัปเดตฝั่ง student ด้วย
  } catch (err) {
    console.error('loadStudentsFromApi fail:', err);
  }
}




// ลองอ่าน user จาก localStorage (มาจาก auth.js หลัง login)
let loggedUser = null;
try {
  const raw = localStorage.getItem('fa_user');
  if (raw) loggedUser = JSON.parse(raw);
} catch (e) {
  console.warn('cannot parse fa_user', e);
}

/* ถ้าไม่มีข้อมูล login ใช้ค่า default Somchai student */
let state = {
  role: loggedUser?.role === 'teacher' ? 'teacher' : 'student',
  currentUser: {
    name: loggedUser?.username || 'Somchai',
    role: loggedUser?.role || 'student',
    student_id: loggedUser?.role === 'student' ? 101 : undefined,
    teacher_id: loggedUser?.role === 'teacher' ? 201 : undefined,
    fingerprint_id: null
  },

  // 👇 ต้องมีอย่างน้อยเป็น array ว่างก่อน
  students: [],

  // 👇 ใส่ subject mock ไปก่อน (ไว้ค่อยดึงจาก DB ภายหลังได้)
  subjects: [
    { subject_id: 1, subject_name: 'Mathematics' },
    { subject_id: 2, subject_name: 'Physics' }
  ],

  sessions: [],
  attendance: [],
  lastAttendanceId: 1000,
  lastSessionId: 500
};


const $ = sel => document.querySelector(sel);

/* ถ้ามี element แสดงชื่อ user / ปุ่ม logout ให้ผูกเหตุการณ์ */
(function setupUserHeader() {
  const nameEl = document.getElementById('current-user') || document.getElementById('user-display');
  if (nameEl) {
    nameEl.innerText = state.currentUser.name + (state.currentUser.role ? ` (${state.currentUser.role})` : '');
  }
  const btnLogout = document.getElementById('btn-logout');
  if (btnLogout) {
    btnLogout.addEventListener('click', () => {
      localStorage.removeItem('fa_user');
      localStorage.removeItem('fa_token');
      window.location.href = '/auth.html';
    });
  }
})();

/* ถ้ามีปุ่มสลับ role (index.html แบบเดิม) ค่อยผูก event */
/* ถ้าเป็นหน้า teacher.html / student.html ที่ไม่มีปุ่ม จะไม่ทำอะไร */
const roleStudentBtn = document.getElementById('role-student');
const roleTeacherBtn = document.getElementById('role-teacher');
if (roleStudentBtn && roleTeacherBtn) {
  roleStudentBtn.addEventListener('click', () => switchRole('student'));
  roleTeacherBtn.addEventListener('click', () => switchRole('teacher'));
}

/* ถ้ามี select วิชาของ student ให้ผูก onchange */
const studentSubSel = document.getElementById('student-subject-select');
if (studentSubSel) {
  studentSubSel.addEventListener('change', renderStudentAttendance);
}

/* =======================================
   init: เลือกว่าจะโชว์ student หรือ teacher
======================================= */

async function init() {
  const studentDash = document.getElementById('student-dashboard');
  const teacherDash = document.getElementById('teacher-dashboard');
  const quickActions = document.getElementById('teacher-quick-actions');

  if (studentDash && teacherDash && roleStudentBtn && roleTeacherBtn) {
    switchRole(state.role);
  } else {
    if (!studentDash && teacherDash) {
      teacherDash.style.display = 'block';
      if (quickActions) quickActions.style.display = 'block';
    }
    if (studentDash && !teacherDash) {
      studentDash.style.display = 'block';
      if (quickActions) quickActions.style.display = 'none';
    }
  }

  // ⭐ โหลดวิชาจาก DB เสมอ (ฝั่ง server จะดูว่าเป็นครูคนไหนจาก token)
  await loadSubjectsFromApi();

  // แล้วค่อย render dropdown, table ต่าง ๆ
  renderSubjectSelectors();
  await loadStudentsFromApi();
  renderStudentSummary();
  renderTeacherSummary();
  renderAttendanceBySession();
}
init();



/* =======================================
   Role switch (เฉพาะกรณีมีปุ่ม)
======================================= */
function switchRole(role) {
  state.role = role;

  const studentDash = document.getElementById('student-dashboard');
  const teacherDash = document.getElementById('teacher-dashboard');
  const quickActions = document.getElementById('teacher-quick-actions');

  if (roleStudentBtn && roleTeacherBtn) {
    roleStudentBtn.classList.toggle('active', role === 'student');
    roleTeacherBtn.classList.toggle('active', role === 'teacher');
  }

  if (studentDash) studentDash.style.display = role === 'student' ? 'block' : 'none';
  if (teacherDash) teacherDash.style.display = role === 'teacher' ? 'block' : 'none';

  if (role === 'teacher') {
    state.currentUser = { name: 'Teacher A', role: 'teacher', teacher_id: 201 };
    if (quickActions) quickActions.style.display = 'block';
  } else {
    state.currentUser = {
      name: loggedUser?.username || 'Somchai',
      role: 'student',
      student_id: 101,
      fingerprint_id: state.students.find(s => s.student_id === 101)?.fingerprint_id || null
    };
    if (quickActions) quickActions.style.display = 'none';
  }

  const nameEl = document.getElementById('current-user') || document.getElementById('user-display');
  if (nameEl) {
    nameEl.innerText = state.currentUser.name + (state.currentUser.role ? ` (${state.currentUser.role})` : '');
  }

  renderStudentSummary();
  renderTeacherSummary();
}

/* =======================================
   Subjects & selectors
======================================= */
function renderSubjectSelectors() {
  const s1 = $('#student-subject-select');
  const t1 = $('#teacher-subject-select');
  if (s1) s1.innerHTML = '';
  if (t1) t1.innerHTML = '<option value="">-- เลือกวิชา --</option>';

  state.subjects.forEach(s => {
    if (s1) {
      const o = document.createElement('option');
      o.value = s.subject_id;
      o.textContent = s.subject_name;
      s1.appendChild(o);
    }
    if (t1) {
      const o2 = document.createElement('option');
      o2.value = s.subject_id;
      o2.textContent = s.subject_name;
      t1.appendChild(o2);
    }
  });

  const firstSub = state.subjects[0];
  if (firstSub) {
    const prevSub = $('#preview-subject');
    const prevTime = $('#preview-time');
    if (prevSub) prevSub.innerText = firstSub.subject_name;
    if (prevTime) prevTime.innerText = 'No session';
  }
}


















/* =======================================
   Student summary + attendance
======================================= */
function renderStudentSummary() {
  const student = state.students.find(s => s.student_id === state.currentUser.student_id) || state.students[0];
  const fpStatusEl = $('#student-fp-status');
  const fpIdEl = $('#student-fp-id');
  if (student && student.fingerprint_id) {
    if (fpStatusEl) fpStatusEl.innerHTML = '<span class="chip">Enrolled</span>';
    if (fpIdEl) fpIdEl.innerText = student.fingerprint_id;
    state.currentUser.fingerprint_id = student.fingerprint_id;
  } else {
    if (fpStatusEl) fpStatusEl.innerHTML = '<span class="chip" style="background:#fff1f0;color:#7f1d1d">Not Enrolled</span>';
    if (fpIdEl) fpIdEl.innerText = '—';
    state.currentUser.fingerprint_id = null;
  }

  const last = state.attendance
    .filter(a => a.student_id === student.student_id)
    .sort((a, b) => new Date(b.time) - new Date(a.time))[0];

  const lastEl = $('#student-last-att');
  if (lastEl) lastEl.innerText = last ? `${new Date(last.time).toLocaleString()} (${last.status})` : '-';

  const todayCountEl = $('#student-today-count');
  if (todayCountEl) todayCountEl.innerText = state.sessions.filter(sess => isToday(sess.date)).length;

  const sselect = $('#student-subject-select');
  if (sselect && sselect.options.length === 0) renderSubjectSelectors();
  renderStudentAttendance();
}

function renderStudentAttendance() {
  const selEl = $('#student-subject-select');
  const sel = selEl ? selEl.value : '';
  const studentId = state.currentUser.student_id;
  let html = '';

  if (!sel) {
    html = '<div class="muted">เลือกวิชาจากเมนูด้านบนเพื่อดูประวัติ</div>';
  } else {
    const subjId = parseInt(sel);
    const sessions = state.sessions
      .filter(s => s.subject_id === subjId)
      .sort((a, b) => new Date(b.date) - new Date(a.date));
    if (sessions.length === 0) {
      html = '<div class="muted">ยังไม่มี session สำหรับวิชานี้</div>';
    } else {
      html = `<table><thead><tr><th>วันที่</th><th>เวลา</th><th>สถานะ</th></tr></thead><tbody>`;
      sessions.forEach(sess => {
        const att = state.attendance.find(a => a.session_id === sess.session_id && a.student_id === studentId);
        const status = att ? att.status : 'Absent';
        html += `<tr><td>${sess.date}</td><td>${sess.start_time} - ${sess.end_time}</td><td>${status}</td></tr>`;
      });
      html += `</tbody></table>`;
    }
  }
  const target = $('#student-att-table');
  if (target) target.innerHTML = html;
}














/* =======================================
   Students management (teacher)
======================================= */
// แสดงตารางนักศึกษา (ใช้ข้อมูลจาก state.students ที่มาจาก DB)
function renderStudents() {
  const q = $('#student-search') ? $('#student-search').value.trim().toLowerCase() : '';
  let rowsHtml = `<table><thead><tr>
        <th>รหัส</th>
        <th>ชื่อ</th>
        <th>ชั้นปี</th>
        <th>Fingerprint</th>
        <th>Actions</th>
    </tr></thead><tbody>`;

  state.students
    .filter(s => !q || s.name.toLowerCase().includes(q))
    .forEach(s => {
      rowsHtml += `<tr>
      <td>${s.student_id}</td>
      <td>${s.name}</td>
      <td>${s.class}</td>
      <td>${s.fingerprint_id ? '<span class="chip">ID ' + s.fingerprint_id + '</span>' : '<span class="muted">Not Registered</span>'}</td>
      <td class="table-actions">
        <button class="btn secondary" onclick="openEditStudent(${s.db_id})">Edit</button>
        <button class="btn" onclick="enrollStudent(${s.db_id})">Enroll</button>
        <button class="btn secondary" onclick="deleteStudent(${s.db_id})">Delete</button>
      </td>
    </tr>`;
    });
  rowsHtml += `</tbody></table>`;

  const target = $('#students-table');
  if (target) target.innerHTML = rowsHtml;
  const totalEl = $('#teacher-total-students');
  if (totalEl) totalEl.innerText = state.students.length;
}


/* ---------- Add Student (ใช้ DB) ---------- */
function openAddStudent() {
  showModal(`<div class="flex-between">
      <h3>เพิ่มนักศึกษา</h3>
      <button onclick="closeModal()" class="btn secondary">Close</button>
    </div>
    <div style="margin-top:12px">
      <div class="form-row">
        <input id="new-code" placeholder="รหัสนักศึกษา เช่น 66123456">
      </div>
      <div class="form-row">
        <input id="new-name" placeholder="ชื่อ–สกุล">
      </div>
      <div class="form-row">
        <input id="new-year" placeholder="ชั้นปี เช่น 1, 2, 3, 4">
      </div>
      <div style="margin-top:12px;display:flex;gap:8px">
        <button class="btn" onclick="addStudent()">Save</button>
        <button class="btn secondary" onclick="closeModal()">Cancel</button>
      </div>
    </div>`);
}

async function addStudent() {
  const code = $('#new-code').value.trim();
  const name = $('#new-name').value.trim();
  const year = $('#new-year').value.trim();

  if (!code || !name) {
    alert('กรุณากรอกรหัสนักศึกษาและชื่อให้ครบ');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/teacher/students`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        student_code: code,
        full_name: name,
        year_level: year ? parseInt(year, 10) : null
      })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'เพิ่มนักศึกษาไม่สำเร็จ');
      return;
    }

    // โหลดข้อมูลใหม่จาก DB แล้ว render
    await loadStudentsFromApi();
    closeModal();
  } catch (err) {
    console.error('addStudent error:', err);
    alert('เกิดข้อผิดพลาดในการเพิ่มนักศึกษา');
  }
}

/* ---------- Edit Student (ใช้ DB) ---------- */
function openEditStudent(dbId) {
  const s = state.students.find(x => x.db_id === dbId);
  if (!s) return;

  showModal(`<div class="flex-between">
      <h3>แก้ไขนักศึกษา</h3>
      <button onclick="closeModal()" class="btn secondary">Close</button>
    </div>
    <div style="margin-top:12px">
      <div class="form-row">
        <input id="edit-code" value="${s.student_id}" placeholder="รหัสนักศึกษา">
      </div>
      <div class="form-row">
        <input id="edit-name" value="${s.name}" placeholder="ชื่อ–สกุล">
      </div>
      <div class="form-row">
        <input id="edit-year" value="${s.class}" placeholder="ชั้นปี">
      </div>
      <div style="margin-top:12px;display:flex;gap:8px">
        <button class="btn" onclick="saveEditStudent(${dbId})">Save</button>
        <button class="btn secondary" onclick="closeModal()">Cancel</button>
      </div>
    </div>`);
}

async function saveEditStudent(dbId) {
  const code = $('#edit-code').value.trim();
  const name = $('#edit-name').value.trim();
  const year = $('#edit-year').value.trim();

  if (!code || !name) {
    alert('กรุณากรอกรหัสนักศึกษาและชื่อให้ครบ');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/teacher/students/${dbId}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        student_code: code,
        full_name: name,
        year_level: year ? parseInt(year, 10) : null
      })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'แก้ไขข้อมูลไม่สำเร็จ');
      return;
    }

    await loadStudentsFromApi();
    closeModal();
  } catch (err) {
    console.error('saveEditStudent error:', err);
    alert('เกิดข้อผิดพลาดในการแก้ไขข้อมูล');
  }
}

/* ---------- Delete Student (ใช้ DB) ---------- */
async function deleteStudent(dbId) {
  if (!confirm('ลบนักศึกษาใช่ไหม?')) return;

  try {
    const res = await fetch(`${API_BASE}/teacher/students/${dbId}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'ลบไม่สำเร็จ');
      return;
    }

    await loadStudentsFromApi();
    renderStudentSummary();
  } catch (err) {
    console.error('deleteStudent error:', err);
    alert('เกิดข้อผิดพลาดในการลบข้อมูล');
  }
}



/* ---------- Enroll Fingerprint (simulate) ---------- */


function enrollFingerprint(student_id) {
  const newFp = Math.floor(Math.random() * 900) + 100;
  const s = state.students.find(x => x.student_id === student_id);
  if (!s) return alert('ไม่พบข้อมูล');
  s.fingerprint_id = newFp;
  alert(`ลงทะเบียนสำเร็จ fingerprint_id = ${newFp} สำหรับ ${s.name}`);
  renderStudents();
  renderStudentSummary();
}





// ---------- Add Subject Modal ----------
function openAddSubject() {
  showModal(`
      <div class="flex-between">
        <h3>Add Subject</h3>
        <button class="btn secondary" onclick="closeModal()">Close</button>
      </div>

      <div style="margin-top:12px">
        <div class="form-row">
          <input id="sub-name" placeholder="ชื่อวิชา เช่น Database Systems">
        </div>
        <div class="form-row">
          <input id="sub-code" placeholder="รหัสวิชา (ถ้ามี) เช่น CS101">
        </div>

        <div style="margin-top:12px;display:flex;gap:8px">
          <button class="btn" onclick="saveSubject()">Save</button>
          <button class="btn secondary" onclick="closeModal()">Cancel</button>
        </div>
      </div>
    `);
}

async function saveSubject() {
  const name = document.getElementById('sub-name').value.trim();
  const code = document.getElementById('sub-code').value.trim();

  if (!name) {
    alert('กรุณากรอกชื่อวิชา');
    return;
  }

  // ⭐ ส่งเข้า DB ผ่าน API /api/teacher/subjects
  try {
    const res = await fetch(`${API_BASE}/teacher/subjects`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ subject_name: name, subject_code: code || null })
    });

    const data = await res.json();
    if (!res.ok) {
      console.error('add subject error:', data.error);
      alert(data.error || 'เพิ่มวิชาไม่สำเร็จ');
      return;
    }

    // เพิ่มเข้า state.subjects ด้วย เพื่อให้ dropdown อัปเดตทันที
    state.subjects.push({
      subject_id: data.subject.subject_id,
      subject_name: data.subject.subject_name,
      teacher_id: data.subject.teacher_id
    });

    closeModal();
    renderSubjectSelectors();   // ให้ dropdown วิชารีเฟรช
  } catch (err) {
    console.error('saveSubject fail:', err);
    alert('server error');
  }
}

async function loadSubjectsFromApi() {
  try {
    const res = await fetch(`${API_BASE}/teacher/subjects`, {
      method: 'GET',
      headers: getAuthHeaders()
    });
    const data = await res.json();

    if (!res.ok) {
      console.error('load subjects error:', data.error);
      return;
    }

    // เก็บวิชาไว้ใน state แล้วเอาไปใช้ใน renderSubjectSelectors()
    state.subjects = data.subjects.map(row => ({
      subject_id: row.subject_id,
      subject_name: row.subject_name,
      teacher_id: row.teacher_id
    }));
  } catch (err) {
    console.error('loadSubjectsFromApi fail:', err);
  }
}










/* =======================================
   Sessions & Attendance (simulate)
======================================= */
function openCreateSession() {
  const subjectOptions = state.subjects.map(s => `<option value="${s.subject_id}">${s.subject_name}</option>`).join('');
  showModal(`<div class="flex-between"><h3>Create Session</h3><button onclick="closeModal()" class="btn secondary">Close</button></div>
  <div style="margin-top:12px">
    <div class="form-row"><select id="new-subject">${subjectOptions}</select></div>
    <div class="form-row"><input id="new-date" type="date" /></div>
    <div class="form-row"><input id="new-start" type="time" /> <input id="new-end" type="time" /></div>
    <div style="margin-top:12px;display:flex;gap:8px"><button class="btn" onclick="createSession()">Create</button><button class="btn secondary" onclick="closeModal()">Cancel</button></div>
  </div>`);
}

async function createSession() {
  const subj = parseInt(document.getElementById('new-subject').value);
  const date = document.getElementById('new-date').value;
  const start = document.getElementById('new-start').value;
  const end = document.getElementById('new-end').value;

  if (!subj || !date || !start) {
    alert('กรอกข้อมูลไม่ครบ');
    return;
  }

  const token = localStorage.getItem('fa_token');
  if (!token) {
    alert('กรุณา login ใหม่');
    return;
  }

  try {
    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        subject_id: subj,
        date: date,
        start_time: start,
        end_time: end || null
      })
    });

    const result = await res.json();

    if (!res.ok) {
      throw new Error(result.error || 'create session failed');
    }

    alert('สร้าง session สำเร็จ');
    closeModal();

    // 🔄 โหลด session ใหม่จาก backend
    await loadSessionsFromServer();

  } catch (err) {
    console.error('Create session error:', err);
    alert('สร้าง session ไม่สำเร็จ');
  }
}






























function simulateScan() {
  if (state.sessions.length === 0) { alert('ไม่มี session ใดๆ ให้ทดสอบ'); return; }
  const latestSession = state.sessions[state.sessions.length - 1];
  const registered = state.students.filter(s => s.fingerprint_id);
  if (registered.length === 0) { alert('ยังไม่มีนักเรียนลงทะเบียนลายนิ้วมือ'); return; }
  const chosen = registered[Math.floor(Math.random() * registered.length)];
  state.lastAttendanceId++;
  const timeNow = new Date().toISOString();
  state.attendance.push({
    attendance_id: state.lastAttendanceId,
    student_id: chosen.student_id,
    session_id: latestSession.session_id,
    time: timeNow,
    status: 'Present',
    source_device: 'MCU-01'
  });
  alert(`Simulated: ${chosen.name} checked-in for session ${latestSession.session_id}`);
  renderTeacherSummary();
  renderAttendanceBySession();
  renderStudentSummary();
}

function simulateStudentScan() {
  const student = state.students.find(s => s.student_id === state.currentUser.student_id);
  if (!student) { alert('ไม่พบข้อมูลนักเรียน'); return; }
  if (!state.sessions.length) { alert('ยังไม่มี session สร้างไว้'); return; }
  if (!student.fingerprint_id) { alert('คุณยังไม่ได้ลงทะเบียนลายนิ้วมือ'); return; }

  state.lastAttendanceId++;
  const timeNow = new Date().toISOString();
  const latestSession = state.sessions[state.sessions.length - 1];

  state.attendance.push({
    attendance_id: state.lastAttendanceId,
    student_id: student.student_id,
    session_id: latestSession.session_id,
    time: timeNow,
    status: 'Present',
    source_device: 'MCU-01'
  });
  alert('เช็กชื่อสำเร็จ (simulate)');
  renderStudentSummary();
  renderTeacherSummary();
}

/* =======================================
   Teacher summary & preview
======================================= */
function renderTeacherSummary() {
  const latest = state.sessions[state.sessions.length - 1];
  const currentSessEl = $('#teacher-current-session');
  const prevSub = $('#preview-subject');
  const prevTime = $('#preview-time');
  const prevStatus = $('#preview-status');
  const presentCountEl = $('#teacher-present-count');

  if (!latest) {
    if (currentSessEl) currentSessEl.innerText = 'No session';
    if (prevSub) prevSub.innerText = '—';
    if (prevTime) prevTime.innerText = '—';
    if (prevStatus) prevStatus.innerText = 'Idle';
    if (presentCountEl) presentCountEl.innerText = 0;
    return;
  }

  const subject = state.subjects.find(s => s.subject_id === latest.subject_id);
  const subjName = subject ? subject.subject_name : `Subject ${latest.subject_id}`;

  if (currentSessEl) currentSessEl.innerText = `${subjName} (${latest.date} ${latest.start_time})`;
  if (prevSub) prevSub.innerText = subjName;
  if (prevTime) prevTime.innerText = `${latest.date} ${latest.start_time} - ${latest.end_time || ''}`;
  if (prevStatus) prevStatus.innerText = 'Live';

  if (presentCountEl) {
    const count = state.attendance.filter(a => a.session_id === latest.session_id).length;
    presentCountEl.innerText = count;
  }
}

/* =======================================
   Modal & helpers
======================================= */
function showModal(html) {
  const m = $('#modal');
  const mb = $('#modal-backdrop');
  if (!m || !mb) return;
  m.innerHTML = html;
  mb.style.display = 'flex';
}
function closeModal() {
  const m = $('#modal');
  const mb = $('#modal-backdrop');
  if (!m || !mb) return;
  mb.style.display = 'none';
  m.innerHTML = '';
}

function showEnrollmentGuide() {
  showModal(`<div class="flex-between"><h3>Enrollment Guide</h3><button onclick="closeModal()" class="btn secondary">Close</button></div>
    <div style="margin-top:12px">
      <ol>
        <li>เลือกนักเรียนที่ต้องการลงทะเบียนจากหน้า Manage Students</li>
        <li>คลิกปุ่ม <strong>Enroll</strong> เพื่อทำการจำลองการสแกน</li>
        <li>ระบบจะสร้าง fingerprint_id แบบสุ่มและผูกกับนักเรียน</li>
        <li>หลังจากลงทะเบียน นักเรียนสามารถสแกนเช็กชื่อได้ (simulate)</li>
      </ol>
      <p class="muted">เมื่อเชื่อม ESP32 จริง ให้ ESP32 ส่ง POST /api/attendance กับ payload ที่มี fingerprint_id และ session_id</p>
    </div>`);
}

// ปิด modal เมื่อคลิกพื้นหลัง
const mb = document.getElementById('modal-backdrop');
if (mb) {
  mb.addEventListener('click', (e) => {
    if (e.target.id === 'modal-backdrop') closeModal();
  });
}

function isToday(dateStr) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
}


function openStartClass() {
  const now = new Date();
  const time = now.toTimeString().slice(0, 5);

  showModal(`
    <h3>เริ่มคาบเรียน</h3>

    <div class="form-row">
      <label>วิชา</label>
      <select id="start-subject">
        ${state.subjects.map(s =>
    `<option value="${s.subject_id}">${s.subject_name}</option>`
  ).join('')}
      </select>
    </div>

    <div class="form-row">
      <label>เวลาเริ่ม</label>
      <input value="${time}" disabled />
    </div>

    <div class="form-row">
      <label>สายหลัง (นาที)</label>
      <input id="late-min" type="number" value="15" />
    </div>

    <div class="form-row">
      <label>ขาดหลัง (นาที)</label>
      <input id="absent-min" type="number" value="60" />
    </div>

    <button class="btn" onclick="startClass()">เริ่มคาบ</button>
  `);
}

window.startClass = async function () {
  console.log('🔥 startClass clicked');

  const subj = parseInt(document.getElementById('start-subject').value);
  const late = parseInt(document.getElementById('late-min').value);
  const absent = parseInt(document.getElementById('absent-min').value);

  if (!subj) {
    alert('กรุณาเลือกวิชา');
    return;
  }

  const token = localStorage.getItem('fa_token');
  if (!token) {
    alert('กรุณา login ใหม่');
    return;
  }

  try {
    const res = await fetch('http://localhost:3000/api/sessions/start', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        subject_id: subj,
        late_min: late,
        absent_min: absent
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    alert('เริ่มคาบเรียนแล้ว');
    closeModal();

    state.currentSession = data.session;
    state.currentSession = data.session;
    await loadLiveDashboard();

  } catch (err) {
    console.error('Start class error:', err);
    alert('เริ่มคาบไม่สำเร็จ');
  }
};


async function endClass() {
  const token = localStorage.getItem('fa_token');
  if (!token) {
    alert('กรุณา login ใหม่');
    return;
  }

  if (!confirm('ต้องการจบคาบเรียนใช่หรือไม่?')) return;

  try {
    const res = await fetch('http://localhost:3000/api/sessions/end', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    alert('จบคาบเรียนเรียบร้อย');

    state.currentSession = null;
    state.currentSession = null;
    await loadLiveDashboard();

  } catch (err) {
    console.error(err);
    alert('End class ไม่สำเร็จ');
  }
}

function updateLiveBadge() {
  const badge = document.getElementById('live-badge');
  if (!badge) return;

  const liveSession = state.sessions.find(s => s.status === 'live');

  if (liveSession) {
    badge.textContent = '🟢 LIVE';
    badge.classList.remove('offline');
    badge.classList.add('live');

    // sync currentSession ด้วย
    state.currentSession = liveSession;
  } else {
    badge.textContent = '⚪ ไม่มีคาบเรียน';
    badge.classList.remove('live');
    badge.classList.add('offline');

    state.currentSession = null;
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  loadLiveDashboard();
  setInterval(loadLiveDashboard, 1000); // รีเฟรชทุก 1 วิ
});



async function enrollStudent(studentId) {
  if (!confirm('ต้องการลงทะเบียนลายนิ้วมือให้นักเรียนคนนี้ใช่หรือไม่?')) return;

  const token = localStorage.getItem('fa_token');

  try {
    const res = await fetch('http://localhost:3000/api/iot/enroll', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        student_id: studentId
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    alert(`📲 กรุณาไปที่เครื่องสแกนเพื่อลงทะเบียนลายนิ้วมือ (ID ${data.fingerprint_id})`);

  } catch (err) {
    console.error(err);
    alert('Enroll ไม่สำเร็จ');
  }
}


async function renderAttendanceBySession() {
  const sessionId = document.getElementById('teacher-session-select').value;
  const token = localStorage.getItem('fa_token');

  if (!sessionId) {
    document.getElementById('attendance-table').innerHTML =
      '<div class="muted">ยังไม่ได้เลือกรอบเรียน</div>';
    return;
  }

  const res = await fetch(
    `http://localhost:3000/api/sessions/${sessionId}/attendance`,
    {
      headers: { Authorization: `Bearer ${token}` }
    }
  );

  const data = await res.json();

  if (!res.ok) {
    alert(data.error || 'โหลดข้อมูลไม่สำเร็จ');
    return;
  }

  const rows = data.attendance.map(st => `
    <tr>
      <td>${st.student_code}</td>
      <td>${st.full_name}</td>
      <td>${st.time_stamp ? new Date(st.time_stamp).toLocaleTimeString() : '--'}</td>
      <td>${st.status || 'Absent'}</td>
      <td>${st.device_id || '-'}</td>
    </tr>
  `).join('');

  document.getElementById('attendance-table').innerHTML = `
    <table>
      <thead>
        <tr>
          <th>รหัส</th>
          <th>ชื่อ</th>
          <th>เวลา</th>
          <th>สถานะ</th>
          <th>device</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}


async function loadSessionsBySubject(subjectId) {
  if (!subjectId) return;
  const token = localStorage.getItem('fa_token');

  try {
    const res = await fetch(
      `http://localhost:3000/api/subjects/${subjectId}/sessions`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) throw new Error('Failed to load sessions');

    const data = await res.json();
    const sel = document.getElementById('teacher-session-select');
    sel.innerHTML = '<option value="">-- เลือกรอบเรียน --</option>';

    if (data.sessions && data.sessions.length > 0) {
      // Sort sessions by date/time descending (latest first) if not already
      // API usually returns them, but let's trust the order or just take the last one if they are ascending.
      // Assuming API returns them in some order. Let's just map them.

      data.sessions.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.session_id;
        const d = new Date(s.date);
        const dateStr = !isNaN(d) ? d.toLocaleDateString('th-TH') : s.date;
        opt.textContent = `${dateStr} ${s.start_time}`;
        sel.appendChild(opt);
      });

      // Auto-select the latest session (assuming the last one in the list is the latest, or first?
      // Usually standard is ascending order in DB. So last element is latest.)
      // Let's pick the last one.
      const latest = data.sessions[data.sessions.length - 1]; // or [0] depending on API sort
      // Actually let's select the last added option effectively.
      sel.value = latest.session_id;

      // Trigger render
      await renderAttendanceBySession();
    } else {
      // No sessions
      document.getElementById('attendance-table').innerHTML = '<div class="muted">ยังไม่มี session สำหรับวิชานี้</div>';
    }

  } catch (err) {
    console.error(err);
    alert('โหลดข้อมูล Session ไม่สำเร็จ');
  }
}


document.getElementById('teacher-subject-select').addEventListener('change', e => {
  loadSessionsBySubject(e.target.value);
});




async function loadLiveDashboard() {
  const token = localStorage.getItem('fa_token');

  const res = await fetch('/api/dashboard/live-summary', {
    headers: { Authorization: `Bearer ${token}` }
  });

  const data = await res.json();

  // 🔥 Render Live Table (Always show panel now)
  const panel = document.getElementById('live-attendance-panel');
  if (panel) panel.style.display = 'block';

  if (data.live && data.session_id) {
    // Pass full session object including new time fields from API
    // `state.currentSession` might be stale, so mix in `data` which has latest absolute times.
    const session = {
      ...state.currentSession,
      ...data, // This includes late_after, absent_after from live-summary
      session_id: data.session_id,
      subject_name: data.subject
    };
    renderLiveAttendanceTable(session);

    // Update Badge to Active
    const badge = document.getElementById('live-badge');
    if (badge) {
      badge.className = 'live-badge online';
      badge.innerHTML = '🟢 กำลังเรียน';
    }

  } else {
    // 💡 No Live Session State
    renderIdleLivePanel();
  }
}


function renderIdleLivePanel() {
  // Render Idle State in the Live Panel
  const infoBar = document.getElementById('live-session-info');
  if (infoBar) {
    infoBar.innerHTML = `<span class="muted">ไม่มีคาบเรียนที่กำลัง Live อยู่ในขณะนี้</span>`;
    infoBar.style.background = '#f1f5f9';
    infoBar.style.color = '#64748b';
  }

  // Reset Stats
  ['live-stat-total', 'live-stat-ontime', 'live-stat-late', 'live-stat-absent']
    .forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerText = '-';
    });

  // Reset Badge to Offline
  const badge = document.getElementById('live-badge');
  if (badge) {
    badge.className = 'live-badge offline';
    badge.innerHTML = '⚪ ไม่มีคาบเรียน';
  }

  // Clear Table
  const tableDiv = document.getElementById('live-attendance-table');
  if (tableDiv) {
    tableDiv.innerHTML = `
            <div style="padding: 40px; text-align: center; color: #94a3b8;">
                <div style="font-size: 48px; margin-bottom: 16px;">💤</div>
                <p>ไม่ได้เริ่มคาบเรียน</p>
                <button class="btn" onclick="openStartClass()" style="margin-top:12px">▶️ เริ่มคาบเรียนใหม่</button>
            </div>
        `;
  }
}

async function renderLiveAttendanceTable(session) {
  const panel = document.getElementById('live-attendance-panel');
  if (!panel) return;
  // Ensure panel is visible (already handled but good to be safe)
  panel.style.display = 'block';

  // 1. Update Info Bar
  const infoBar = document.getElementById('live-session-info');

  // Use active style
  if (infoBar) {
    infoBar.style.background = '#dcfce7';
    infoBar.style.color = '#166534';
  }

  const subjName = session.subject_name || state.subjects.find(s => s.subject_id == session.subject_id)?.subject_name || 'Unknown Subject';
  const startTime = session.start_time ? session.start_time.slice(0, 5) : '00:00';

  // Use absolute times directly from DB (provided by API)
  // Ensure they are formatted to HH:mm
  const lateTime = session.late_after ? session.late_after.slice(0, 5) : '--:--';
  const absentTime = session.absent_after ? session.absent_after.slice(0, 5) : '--:--';

  if (infoBar) {
    infoBar.innerHTML = `📚 <strong>${subjName}</strong> | เริ่ม ${startTime} | สาย ${lateTime} | ขาด ${absentTime}`;
  }

  const token = localStorage.getItem('fa_token');
  try {
    const res = await fetch(`http://localhost:3000/api/sessions/${session.session_id}/attendance`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();

    if (!res.ok) return;

    const attendees = data.attendance || [];

    // 2. Calculate Stats
    // Assuming API might return all students (left join) or just scanned ones.
    // Depend on time_stamp to determine if actually scanned.
    const totalStudents = state.students.length;

    // Filter only those who have actually scanned
    const scannedList = attendees.filter(a => a.time_stamp && a.time_stamp !== null);

    const scannedCount = scannedList.length;
    const notScannedCount = totalStudents - scannedCount;

    const onTime = scannedList.filter(a => a.status === 'Present' || a.status === 'On Time').length;
    const late = scannedList.filter(a => a.status === 'Late').length;

    // Update Cards
    if (document.getElementById('live-stat-total')) document.getElementById('live-stat-total').innerText = totalStudents;
    if (document.getElementById('live-stat-ontime')) document.getElementById('live-stat-ontime').innerText = onTime;
    if (document.getElementById('live-stat-late')) document.getElementById('live-stat-late').innerText = late;
    if (document.getElementById('live-stat-absent')) document.getElementById('live-stat-absent').innerText = notScannedCount < 0 ? 0 : notScannedCount;

    // 3. Render Table - Show only scanned ones or all? 
    // Usually Live Feed shows only scans. 
    // If user wants to see who is missing, the big red number tells them. 
    // Let's show only SCANNED list in the table for "Live Feed" feel.
    // Or if API returned all, maybe show them with status?
    // Let's stick to showing only those with time_stamp for the table rows to match "Live" concept.

    const validRows = scannedList.map(st => {
      const timeStr = st.time_stamp ? new Date(st.time_stamp).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : '--';
      let statusBadge = `<span class="chip success">มาตรงเวลา</span>`;
      if (st.status === 'Late') statusBadge = `<span class="chip warning">มาสาย</span>`;
      if (st.status === 'Absent') statusBadge = `<span class="chip danger">ขาด</span>`;

      return `
            <tr class="fade-in">
                <td>${st.student_code}</td>
                <td>${st.full_name}</td>
                <td>${timeStr}</td>
                <td>${statusBadge}</td>
            </tr>
        `;
    }).join('');

    const tableHtml = `
        <table>
            <thead style="background: #f1f5f9;">
                <tr>
                    <th style="color:#64748b;">รหัส</th>
                    <th style="color:#64748b;">ชื่อ</th>
                    <th style="color:#64748b;">เวลาสแกน</th>
                    <th style="color:#64748b;">สถานะ</th>
                </tr>
            </thead>
            <tbody>${validRows.length ? validRows : '<tr><td colspan="4" class="muted center">รอการสแกน...</td></tr>'}</tbody>
        </table>
    `;

    document.getElementById('live-attendance-table').innerHTML = tableHtml;

  } catch (err) {
    console.error('Render Live Table Error', err);
  }
}

/* =======================================
   View Navigation
======================================= */
function toggleManageStudents(show) {
  const dash = document.getElementById('teacher-dashboard');
  const manage = document.getElementById('manage-students-view');

  if (show) {
    if (dash) dash.style.display = 'none';
    if (manage) manage.style.display = 'block';
    renderStudents(); // refresh list when opening
  } else {
    if (dash) dash.style.display = 'block';
    if (manage) manage.style.display = 'none';
  }
}
