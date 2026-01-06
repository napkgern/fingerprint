// server.js (ปรับปรุง)
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('./db');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// serve static files from public/
app.use(express.static(path.join(__dirname, 'public')));

const JWT_SECRET = process.env.JWT_SECRET || 'secret';
const SALT_ROUNDS = parseInt(process.env.SALT_ROUNDS || '10', 10);

/* ------------------ Helpers ------------------ */
async function findUserByUsernameOrEmail(identifier) {
  const [rows] = await pool.query(
    'SELECT user_id, username, email, password_hash, role FROM users WHERE username = ? OR email = ? LIMIT 1',
    [identifier, identifier]
  );
  return rows[0];
}

/* ------------------ Register ------------------ */
app.post('/api/register', async (req, res) => {
  try {
    const { name, username, email, password, role = 'student', student_code } = req.body;
    if (!username || !password || !name) return res.status(400).json({ error: 'ข้อมูลไม่ครบ' });

    const [existsRows] = await pool.query('SELECT user_id FROM users WHERE username = ? OR email = ? LIMIT 1', [username, email]);
    if (existsRows.length) return res.status(400).json({ error: 'username หรือ email มีแล้ว' });

    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    const [r] = await pool.query('INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)', [username, email || null, hash, role]);
    const userId = r.insertId;

    if (role === 'student') {
      await pool.query('INSERT INTO students (user_id, student_code, full_name) VALUES (?, ?, ?)', [userId, student_code || null, name]);
    } else if (role === 'teacher') {
      await pool.query('INSERT INTO teachers (user_id, full_name) VALUES (?, ?)', [userId, name]);
    }

    const token = jwt.sign({ user_id: userId, username, role }, JWT_SECRET, { expiresIn: '8h' });
    res.json({ token, user: { user_id: userId, username, email, role } });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'server error' });
  }
});

/* ------------------ Login ------------------ */
app.post('/api/login', async (req, res) => {
  try {
    const { usernameOrEmail, password } = req.body;
    if (!usernameOrEmail || !password) return res.status(400).json({ error: 'ข้อมูลไม่ครบ' });

    const user = await findUserByUsernameOrEmail(usernameOrEmail);
    if (!user) return res.status(400).json({ error: 'ไม่พบผู้ใช้' });

    // password_hash must exist in user record
    if (!user.password_hash) return res.status(500).json({ error: 'user has no password hash' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(400).json({ error: 'รหัสผ่านไม่ถูกต้อง' });

    const token = jwt.sign({ user_id: user.user_id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '8h' });
    res.json({ token, user: { user_id: user.user_id, username: user.username, email: user.email, role: user.role } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'server error' });
  }
});

/* ------------------ Auth middleware ------------------ */
function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'No token provided' });
  const parts = header.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') return res.status(401).json({ error: 'Invalid authorization header format' });
  const token = parts[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

/* ------------------ Get profile ------------------ */
app.get('/api/me', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT user_id, username, email, role FROM users WHERE user_id = ?', [req.user.user_id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ user: rows[0] });
  } catch (err) {
    console.error('Get /api/me error:', err);
    res.status(500).json({ error: 'server error' });
  }
});

/* ------------------ Attendance POST (from ESP32) ------------------ */
app.post('/api/attendance', async (req, res) => {
  try {
    const { fingerprint_id, session_id, device_id } = req.body;
    if (!fingerprint_id || !session_id) {
      return res.status(400).json({ error: 'missing data' });
    }

    // 1️⃣ หา session
    const [sessRows] = await pool.query(
      `
      SELECT start_time, late_after, absent_after, status
      FROM sessions
      WHERE session_id = ?
      `,
      [session_id]
    );

    if (!sessRows.length || sessRows[0].status !== 'live') {
      return res.status(403).json({ error: 'session not live' });
    }

    const session = sessRows[0];

    // 2️⃣ เวลา ณ ตอนนี้ (HH:mm:ss)
    const now = new Date();
    const nowTime = now.toTimeString().slice(0, 8);

    // 3️⃣ ตัดสินสถานะ
    let attendanceStatus = 'Present';

    if (session.absent_after && nowTime > session.absent_after) {
      attendanceStatus = 'Absent';
    } else if (session.late_after && nowTime > session.late_after) {
      attendanceStatus = 'Late';
    }

    // 4️⃣ หา student
    const [stu] = await pool.query(
      'SELECT student_id FROM students WHERE fingerprint_id = ?',
      [fingerprint_id]
    );
    if (!stu.length) {
      return res.status(404).json({ error: 'unknown fingerprint' });
    }

    const student_id = stu[0].student_id;

    // 5️⃣ insert attendance
    await pool.query(
      `
      INSERT INTO attendance
      (student_id, session_id, status, fingerprint_id, device_id)
      VALUES (?, ?, ?, ?, ?)
      `,
      [student_id, session_id, attendanceStatus, fingerprint_id, device_id || null]
    );

    res.json({
      ok: true,
      status: attendanceStatus
    });

  } catch (err) {
    console.error('Attendance error:', err);
    res.status(500).json({ error: 'server error' });
  }
});



app.get('/api/iot/live-session', async (req, res) => {
  const [rows] = await pool.query(
    `SELECT session_id
     FROM sessions
     WHERE status = 'live'
     ORDER BY session_id DESC
     LIMIT 1`
  );

  if (rows.length === 0) {
    return res.json({ live: false });
  }

  res.json({
    live: true,
    session_id: rows[0].session_id
  });
});


/* ------------------ Simple query: sessions for subject ------------------ */
app.get('/api/subjects/:subjectId/sessions', authMiddleware, async (req, res) => {
  try {
    const subjectId = req.params.subjectId;
    const [rows] = await pool.query('SELECT * FROM sessions WHERE subject_id = ? ORDER BY date DESC', [subjectId]);
    res.json({ sessions: rows });
  } catch (err) {
    console.error('Get sessions error:', err);
    res.status(500).json({ error: 'server error' });
  }
});

/* ------------------ Health / root ------------------ */
app.get('/health', (req, res) => res.json({ ok: true }));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'auth.html')));

/* ------------------ Start ------------------ */
const PORT = process.env.PORT || 3000;

async function checkPool() {
  try {
    await pool.query('SELECT 1');
    console.log('DB connection OK');
  } catch (err) {
    console.error('DB connection failed:', err);
  }
}

app.listen(PORT, async () => {
  console.log(`API listening on port ${PORT}`);
  await checkPool();
});

setInterval(autoEndSessions, 10 * 1000);


// ดึงรายชื่อนักเรียนทั้งหมด (สำหรับครู)
app.get('/api/teacher/students', authMiddleware, async (req, res) => {
  try {
    // อนุญาตเฉพาะ teacher หรือ admin
    if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'No permission' });
    }

    const [rows] = await pool.query(
      `SELECT 
                s.student_id,      -- PK ของตาราง students
                s.student_code,    -- รหัสนักเรียนที่อยากโชว์ในคอลัมน์ "รหัส"
                s.full_name,
                s.year_level,
                s.fingerprint_id
             FROM students s
             ORDER BY s.student_code`
    );

    res.json({ students: rows });
  } catch (err) {
    console.error('Get students error:', err);
    res.status(500).json({ error: 'server error' });
  }
});

app.get('/api/teacher/students', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT student_id, student_code, full_name, year_level, fingerprint_id FROM students'
    );
    res.json({ students: rows });
  } catch (err) {
    console.error('teacher/students error:', err);
    res.status(500).json({ error: 'server error' });
  }
});

// CREATE student
app.post('/api/teacher/students', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'No permission' });
    }

    const { student_code, full_name, year_level } = req.body;
    if (!student_code || !full_name) {
      return res.status(400).json({ error: 'ข้อมูลไม่ครบ' });
    }

    const [r] = await pool.query(
      'INSERT INTO students (student_code, full_name, year_level) VALUES (?, ?, ?)',
      [student_code, full_name, year_level || null]
    );

    res.json({ ok: true, student_id: r.insertId });
  } catch (err) {
    console.error('POST /teacher/students error:', err);
    res.status(500).json({ error: 'server error' });
  }
});

// UPDATE student
app.put('/api/teacher/students/:id', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'No permission' });
    }

    const id = req.params.id;
    const { student_code, full_name, year_level } = req.body;

    await pool.query(
      'UPDATE students SET student_code = ?, full_name = ?, year_level = ? WHERE student_id = ?',
      [student_code, full_name, year_level || null, id]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('PUT /teacher/students/:id error:', err);
    res.status(500).json({ error: 'server error' });
  }
});

// DELETE student
app.delete('/api/teacher/students/:id', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'No permission' });
    }

    const studentId = req.params.id;

    // 1️⃣ ลบ enroll commands ก่อน
    await pool.query(
      'DELETE FROM enroll_commands WHERE student_id = ?',
      [studentId]
    );

    // 2️⃣ ลบ attendance
    await pool.query(
      'DELETE FROM attendance WHERE student_id = ?',
      [studentId]
    );

    // 3️⃣ ลบนักเรียน
    await pool.query(
      'DELETE FROM students WHERE student_id = ?',
      [studentId]
    );

    res.json({ ok: true });

  } catch (err) {
    console.error('DELETE student error:', err);
    res.status(500).json({ error: 'server error' });
  }
});


// เพิ่มวิชาใหม่ให้ครูคนนั้น
// ------------------ Teacher: subjects ------------------

// ดึงรายวิชาของครูที่ login
app.get('/api/teacher/subjects', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'No permission' });
    }

    // หา teacher_id จาก user_id ที่ login
    const [trows] = await pool.query(
      'SELECT teacher_id FROM teachers WHERE user_id = ? LIMIT 1',
      [req.user.user_id]
    );
    if (!trows.length) {
      return res.status(400).json({ error: 'ไม่พบข้อมูลครูของ user นี้' });
    }
    const teacherId = trows[0].teacher_id;

    const [rows] = await pool.query(
      'SELECT subject_id, subject_name, teacher_id FROM subjects WHERE teacher_id = ?',
      [teacherId]
    );

    res.json({ subjects: rows });
  } catch (err) {
    console.error('Get subjects error:', err);
    res.status(500).json({ error: 'server error' });
  }
});

// เพิ่มวิชาใหม่ให้ครูที่ login
app.post('/api/teacher/subjects', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'No permission' });
    }

    const { subject_name, subject_code } = req.body;
    if (!subject_name) {
      return res.status(400).json({ error: 'ต้องกรอกชื่อวิชา' });
    }

    const [trows] = await pool.query(
      'SELECT teacher_id FROM teachers WHERE user_id = ? LIMIT 1',
      [req.user.user_id]
    );
    if (!trows.length) {
      return res.status(400).json({ error: 'ไม่พบข้อมูลครูของ user นี้' });
    }
    const teacherId = trows[0].teacher_id;

    const [r] = await pool.query(
      'INSERT INTO subjects (subject_name, teacher_id) VALUES (?, ?)',
      [subject_name, teacherId]
    );

    res.json({
      subject: {
        subject_id: r.insertId,
        subject_name,
        subject_code: subject_code || null,
        teacher_id: teacherId
      }
    });
  } catch (err) {
    console.error('Add subject error:', err);
    res.status(500).json({ error: 'server error' });
  }
});


// GET sessions
app.get('/api/sessions', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `
      SELECT session_id, subject_id, date,
             start_time, end_time, status
      FROM sessions
      ORDER BY session_id DESC
      `
    );
    res.json(rows);
  } catch (err) {
    console.error('GET sessions error:', err);
    res.status(500).json({ error: 'โหลด session ไม่สำเร็จ' });
  }
});



app.post('/api/sessions/start', authMiddleware, async (req, res) => {
  try {
    const { subject_id, late_min, absent_min } = req.body;
    const teacher_id = req.user.user_id;

    // 🔒 กัน live ซ้อน
    const [live] = await pool.query(
      `SELECT session_id FROM sessions WHERE status='live' AND created_by=?`,
      [teacher_id]
    );
    if (live.length > 0) {
      return res.status(400).json({ error: 'มีคาบเรียนที่กำลังเรียนอยู่แล้ว' });
    }

    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const startTime = now.toTimeString().slice(0, 8);
    const lateTime = new Date(now.getTime() + late_min * 60000)
      .toTimeString().slice(0, 8);
    const absentTime = new Date(now.getTime() + absent_min * 60000)
      .toTimeString().slice(0, 8);

    const [result] = await pool.query(
      `
      INSERT INTO sessions
      (subject_id, date, start_time, late_after, absent_after, status, created_by)
      VALUES (?, ?, ?, ?, ?, 'live', ?)
      `,
      [subject_id, date, startTime, lateTime, absentTime, teacher_id]
    );

    res.json({ session_id: result.insertId });

  } catch (err) {
    console.error('Start class error:', err);
    res.status(500).json({ error: 'เริ่มคาบไม่สำเร็จ' });
  }
});


app.post('/api/sessions/end', authMiddleware, async (req, res) => {
  try {
    const teacherId = req.user.user_id;

    // 🔍 หา LIVE session ของอาจารย์คนนี้
    const [rows] = await pool.query(
      `
      SELECT session_id
      FROM sessions
      WHERE status = 'live'
        AND created_by = ?
      LIMIT 1
      `,
      [teacherId]
    );

    if (rows.length === 0) {
      return res.status(400).json({
        error: 'ไม่มี session ที่กำลังเรียนอยู่'
      });
    }

    const sessionId = rows[0].session_id;

    // ⏰ เวลาไทยจาก Node.js
    const now = new Date();
    const endTime = now.toTimeString().slice(0, 8);

    // 🔴 ปิดคาบ
    await pool.query(
      `
      UPDATE sessions
      SET status = 'finished',
      end_time = ?
      WHERE session_id = ?
      `,
      [endTime, sessionId]
    );

    res.json({
      message: 'จบคาบเรียนเรียบร้อย',
      session_id: sessionId
    });

  } catch (err) {
    console.error('End class error:', err);
    res.status(500).json({ error: 'server error' });
  }
});



app.post('/api/teacher/enroll', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'No permission' });
    }

    const { student_id } = req.body;
    if (!student_id) {
      return res.status(400).json({ error: 'missing student_id' });
    }

    // 🔢 หา fingerprint_id ถัดไป
    const [rows] = await pool.query(
      'SELECT MAX(fingerprint_id) AS maxId FROM students'
    );
    const nextFingerId = (rows[0].maxId || 0) + 1;

    // 🟡 สร้างคำสั่ง enroll
    const [r] = await pool.query(
      `INSERT INTO enroll_commands (student_id, fingerprint_id)
       VALUES (?, ?)`,
      [student_id, nextFingerId]
    );

    res.json({
      message: 'Enroll command created',
      command_id: r.insertId,
      fingerprint_id: nextFingerId
    });

  } catch (err) {
    console.error('Enroll error:', err);
    res.status(500).json({ error: 'server error' });
  }
});


// สั่ง enroll ลายนิ้วมือ
app.post('/api/iot/enroll', authMiddleware, async (req, res) => {
  try {
    const { student_id } = req.body;

    // หา fingerprint_id ว่าง
    const [rows] = await pool.query(
      `SELECT MAX(fingerprint_id) AS maxId FROM students`
    );
    const newFingerprintId = (rows[0].maxId || 0) + 1;

    // สร้างคำสั่ง enroll
    const [r] = await pool.query(
      `INSERT INTO enroll_commands (student_id, fingerprint_id, status)
       VALUES (?, ?, 'pending')`,
      [student_id, newFingerprintId]
    );

    res.json({
      command_id: r.insertId,
      fingerprint_id: newFingerprintId
    });

  } catch (err) {
    console.error('Enroll command error:', err);
    res.status(500).json({ error: 'server error' });
  }
});


app.get('/api/iot/mode', async (req, res) => {
  try {
    // 1️⃣ เช็ค enroll ก่อน
    const [enroll] = await pool.query(
      `
      SELECT id, fingerprint_id
      FROM enroll_commands
      WHERE status = 'pending'
      ORDER BY id ASC
      LIMIT 1
      `
    );

    if (enroll.length > 0) {
      return res.json({
        mode: 'enroll',
        command_id: enroll[0].id,          // 👈 ใช้ id
        fingerprint_id: enroll[0].fingerprint_id
      });
    }

    // 2️⃣ เช็ค live session
    const [live] = await pool.query(
      `
      SELECT session_id
      FROM sessions
      WHERE status = 'live'
      ORDER BY session_id DESC
      LIMIT 1
      `
    );

    if (live.length > 0) {
      return res.json({
        mode: 'scan',
        session_id: live[0].session_id
      });
    }

    res.json({ mode: 'idle' });

  } catch (err) {
    console.error('iot/mode error:', err);
    res.status(500).json({ mode: 'idle' });
  }
});






app.post('/api/iot/enroll/done', async (req, res) => {
  const { command_id } = req.body;

  // 🔍 ดึงข้อมูลคำสั่ง
  const [cmd] = await pool.query(
    `
    SELECT student_id, fingerprint_id
    FROM enroll_commands
    WHERE id = ?
    `,
    [command_id]
  );

  if (!cmd.length) {
    return res.status(404).json({ error: 'command not found' });
  }

  // 1️⃣ ผูก fingerprint ให้ student
  await pool.query(
    `
    UPDATE students
    SET fingerprint_id = ?
    WHERE student_id = ?
    `,
    [cmd[0].fingerprint_id, cmd[0].student_id]
  );

  // 2️⃣ ปิดคำสั่ง enroll (ตัวนี้แหละที่ห้ามลืม ❗)
  await pool.query(
    `
    UPDATE enroll_commands
    SET status = 'done'
    WHERE id = ?
    `,
    [command_id]
  );

  res.json({ ok: true });
});




async function autoEndSessions() {
  try {
    const now = new Date();
    const nowTime = now.toTimeString().slice(0, 8); // HH:mm:ss

    // 🔍 หา session ที่ live และเลย absent_after
    const [rows] = await pool.query(
      `
      SELECT session_id
      FROM sessions
      WHERE status = 'live'
        AND absent_after <= ?
      `,
      [nowTime]
    );

    if (rows.length === 0) return;

    for (const row of rows) {
      await pool.query(
        `
        UPDATE sessions
        SET status = 'finished',
            end_time = ?
        WHERE session_id = ?
        `,
        [nowTime, row.session_id]
      );

      console.log(`⏱ Auto ended session ${row.session_id}`);
    }

  } catch (err) {
    console.error('Auto end error:', err);
  }
}


// GET attendance by session
app.get('/api/sessions/:sessionId/attendance', authMiddleware, async (req, res) => {
  try {
    const sessionId = req.params.sessionId;

    const [rows] = await pool.query(`
      SELECT
        s.student_id,
        s.student_code,
        s.full_name,
        a.status,
        a.time_stamp,
        a.device_id
      FROM students s
      LEFT JOIN attendance a
        ON s.student_id = a.student_id
       AND a.session_id = ?
      ORDER BY s.student_code
    `, [sessionId]);

    res.json({ attendance: rows });

  } catch (err) {
    console.error('Get attendance error:', err);
    res.status(500).json({ error: 'server error' });
  }
});


app.get('/api/dashboard/live-summary', authMiddleware, async (req, res) => {
  try {
    // หา session live
    const [live] = await pool.query(`
      SELECT s.session_id, s.subject_id, sb.subject_name, s.date, s.start_time, s.late_after, s.absent_after
      FROM sessions s
      JOIN subjects sb ON s.subject_id = sb.subject_id
      WHERE s.status = 'live'
      LIMIT 1
    `);

    if (!live.length) {
      return res.json({ live: false });
    }

    const session = live[0];

    const [rows] = await pool.query(`
      SELECT status, COUNT(*) AS cnt
      FROM attendance
      WHERE session_id = ?
      GROUP BY status
    `, [session.session_id]);

    let onTime = 0;
    let late = 0;

    for (const r of rows) {
      if (r.status === 'Present') onTime = r.cnt;
      if (r.status === 'Late') late = r.cnt;
    }

    res.json({
      live: true,
      session_id: session.session_id,
      subject: session.subject_name,
      date: session.date,
      start_time: session.start_time,
      late_after: session.late_after,
      absent_after: session.absent_after
    });
  } catch (err) {
    console.error('Live summary error:', err);
    res.status(500).json({ error: 'server error' });
  }
});
