-- PostgreSQL Schema for Fingerprint Attendance

-- Drop tables if they exist (order matters due to foreign keys)
DROP TABLE IF EXISTS attendance;
DROP TABLE IF EXISTS enroll_commands;
DROP TABLE IF EXISTS scan_sessions;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS subjects;
DROP TABLE IF EXISTS teachers;
DROP TABLE IF EXISTS students;
DROP TABLE IF EXISTS users;

-- Drop types if they exist
DROP TYPE IF EXISTS user_role;
DROP TYPE IF EXISTS session_status;
DROP TYPE IF EXISTS attendance_status;
DROP TYPE IF EXISTS enroll_status;
DROP TYPE IF EXISTS scan_status;

-- Create Enums
CREATE TYPE user_role AS ENUM ('student', 'teacher', 'admin');
CREATE TYPE session_status AS ENUM ('scheduled', 'live', 'finished');
CREATE TYPE attendance_status AS ENUM ('Present', 'Absent', 'Late');
CREATE TYPE enroll_status AS ENUM ('pending', 'done');
CREATE TYPE scan_status AS ENUM ('idle', 'scanning', 'closed');

-- Table: users
CREATE TABLE users (
    user_id SERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(120),
    password_hash VARCHAR(255) NOT NULL,
    role user_role NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Table: teachers
CREATE TABLE teachers (
    teacher_id SERIAL PRIMARY KEY,
    user_id INT UNIQUE REFERENCES users(user_id) ON DELETE SET NULL,
    full_name VARCHAR(200) NOT NULL,
    phone VARCHAR(30)
);

-- Table: subjects
CREATE TABLE subjects (
    subject_id SERIAL PRIMARY KEY,
    subject_name VARCHAR(150) NOT NULL,
    teacher_id INT NOT NULL REFERENCES teachers(teacher_id) ON DELETE CASCADE
);

-- Table: sessions
CREATE TABLE sessions (
    session_id SERIAL PRIMARY KEY,
    subject_id INT NOT NULL REFERENCES subjects(subject_id) ON DELETE CASCADE,
    date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME,
    late_after TIME,
    absent_after TIME,
    status session_status DEFAULT 'scheduled',
    created_by INT -- could reference users or teachers, strictly standard SQL: REFERENCES users(user_id)
);

-- Table: students
CREATE TABLE students (
    student_id SERIAL PRIMARY KEY,
    user_id INT UNIQUE REFERENCES users(user_id) ON DELETE SET NULL,
    student_code VARCHAR(50) UNIQUE,
    full_name VARCHAR(200) NOT NULL,
    year_level INT,
    fingerprint_id INT
);

-- Table: attendance
CREATE TABLE attendance (
    attendance_id SERIAL PRIMARY KEY,
    student_id INT REFERENCES students(student_id) ON DELETE SET NULL,
    session_id INT REFERENCES sessions(session_id) ON DELETE CASCADE,
    time_stamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status attendance_status DEFAULT 'Present',
    fingerprint_id INT,
    device_id VARCHAR(50)
);

-- Table: enroll_commands
CREATE TABLE enroll_commands (
    id SERIAL PRIMARY KEY,
    student_id INT, -- could reference students
    fingerprint_id INT,
    status enroll_status DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Table: scan_sessions
CREATE TABLE scan_sessions (
    id SERIAL PRIMARY KEY,
    subject_id INT,
    session_id INT,
    status scan_status DEFAULT 'idle',
    started_at TIMESTAMP
);
