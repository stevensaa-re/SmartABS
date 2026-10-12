-- =========================================================
-- SMARTABS — Skema MySQL / MariaDB
-- Jalankan:  mysql -u root -p < database/mysql/schema.sql
--       atau: cd server && npm run db:init
-- Butuh MySQL 5.7+ / MariaDB 10.3+, engine InnoDB (untuk foreign key)
-- =========================================================

CREATE DATABASE IF NOT EXISTS smartabs
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE smartabs;

-- Urutan DROP mengikuti ketergantungan foreign key (anak dulu)
SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS permissions;
DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS calendar_events;
DROP TABLE IF EXISTS school_profile;
DROP TABLE IF EXISTS attendance;
DROP TABLE IF EXISTS schedules;
DROP TABLE IF EXISTS announcements;
DROP TABLE IF EXISTS teachers;
DROP TABLE IF EXISTS students;
DROP TABLE IF EXISTS classes;
DROP TABLE IF EXISTS users;
SET FOREIGN_KEY_CHECKS = 1;

-- ---------------------------------------------------------
-- users : akun login (admin / guru / siswa)
-- Password disimpan sebagai hash bcrypt, TIDAK PERNAH teks polos.
-- Collation *_ci membuat username unik tanpa peduli huruf besar/kecil.
-- ---------------------------------------------------------
CREATE TABLE users (
  id            VARCHAR(20)  NOT NULL,
  name          VARCHAR(100) NOT NULL,
  username      VARCHAR(50)  NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role          ENUM('admin','guru','siswa') NOT NULL,
  status        ENUM('Aktif','Nonaktif') NOT NULL DEFAULT 'Aktif',
  email         VARCHAR(120) NOT NULL DEFAULT '',
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_username (username)
) ENGINE=InnoDB;

-- ---------------------------------------------------------
-- school_profile : konfigurasi untuk satu sekolah
-- ---------------------------------------------------------
CREATE TABLE school_profile (
  id               TINYINT UNSIGNED NOT NULL DEFAULT 1,
  name             VARCHAR(160) NOT NULL DEFAULT '',
  address          VARCHAR(500) NOT NULL DEFAULT '',
  phone            VARCHAR(40) NOT NULL DEFAULT '',
  education_levels TEXT NOT NULL,
  majors           TEXT NOT NULL,
  updated_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------
-- classes : data kelas
-- ---------------------------------------------------------
CREATE TABLE classes (
  id        VARCHAR(20)  NOT NULL,
  name      VARCHAR(50)  NOT NULL,
  education_level VARCHAR(10) NOT NULL DEFAULT 'SMA',
  level     VARCHAR(10)  NOT NULL,
  major     VARCHAR(30)  NOT NULL,
  homeroom  VARCHAR(100) NOT NULL DEFAULT '',
  capacity  SMALLINT UNSIGNED NOT NULL DEFAULT 36,
  PRIMARY KEY (id),
  UNIQUE KEY uq_classes_name (name)
) ENGINE=InnoDB;

-- ---------------------------------------------------------
-- students : data induk siswa (kunci = NIS)
-- user_id menghubungkan siswa dengan akun login (opsional)
-- ---------------------------------------------------------
CREATE TABLE students (
  nis      VARCHAR(20)  NOT NULL,
  name     VARCHAR(100) NOT NULL,
  nisn     CHAR(10)     NULL,
  class_id VARCHAR(20)  NOT NULL,
  gender   ENUM('L','P') NOT NULL DEFAULT 'L',
  status   ENUM('Aktif','Nonaktif') NOT NULL DEFAULT 'Aktif',
  user_id  VARCHAR(20)  NULL,
  phone    VARCHAR(30)  NOT NULL DEFAULT '',
  birth_place VARCHAR(100) NOT NULL DEFAULT '',
  birth_date DATE NULL,
  address VARCHAR(500) NOT NULL DEFAULT '',
  father_name VARCHAR(100) NOT NULL DEFAULT '',
  mother_name VARCHAR(100) NOT NULL DEFAULT '',
  guardian_name VARCHAR(100) NOT NULL DEFAULT '',
  PRIMARY KEY (nis),
  UNIQUE KEY uq_students_nisn (nisn),
  UNIQUE KEY uq_students_user (user_id),
  KEY idx_students_class (class_id),
  CONSTRAINT fk_students_class FOREIGN KEY (class_id) REFERENCES classes (id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_students_user FOREIGN KEY (user_id) REFERENCES users (id)
    ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB;

-- ---------------------------------------------------------
-- teachers : profil guru (satu akun guru = satu profil)
-- ---------------------------------------------------------
CREATE TABLE teachers (
  id       VARCHAR(20)  NOT NULL,
  user_id  VARCHAR(20)  NOT NULL,
  name     VARCHAR(100) NOT NULL,
  subject  VARCHAR(100) NOT NULL DEFAULT '',
  class_id VARCHAR(20)  NULL,
  status   ENUM('Aktif','Nonaktif') NOT NULL DEFAULT 'Aktif',
  PRIMARY KEY (id),
  UNIQUE KEY uq_teachers_user (user_id),
  KEY idx_teachers_class (class_id),
  CONSTRAINT fk_teachers_user FOREIGN KEY (user_id) REFERENCES users (id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_teachers_class FOREIGN KEY (class_id) REFERENCES classes (id)
    ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB;

-- ---------------------------------------------------------
-- schedules : jadwal pelajaran
-- ---------------------------------------------------------
CREATE TABLE schedules (
  id           VARCHAR(20)  NOT NULL,
  day          ENUM('Senin','Selasa','Rabu','Kamis','Jumat','Sabtu') NOT NULL,
  start_time   TIME         NOT NULL,
  end_time     TIME         NOT NULL,
  subject      VARCHAR(100) NOT NULL,
  teacher_name VARCHAR(100) NOT NULL,
  class_id     VARCHAR(20)  NOT NULL,
  PRIMARY KEY (id),
  KEY idx_schedules_class_day (class_id, day),
  CONSTRAINT fk_schedules_class FOREIGN KEY (class_id) REFERENCES classes (id)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------
-- announcements : pengumuman
-- ---------------------------------------------------------
CREATE TABLE announcements (
  id      VARCHAR(20)  NOT NULL,
  title   VARCHAR(200) NOT NULL,
  content TEXT         NOT NULL,
  `date`  DATE         NOT NULL,
  status  ENUM('Publish','Draft') NOT NULL DEFAULT 'Publish',
  PRIMARY KEY (id),
  KEY idx_announcements_date (`date`)
) ENGINE=InnoDB;

-- ---------------------------------------------------------
-- attendance : satu baris per siswa, tanggal, dan mata pelajaran.
-- class_id adalah "snapshot" kelas saat absensi dicatat, sehingga
-- riwayat tetap benar walaupun siswa kemudian pindah kelas.
-- ---------------------------------------------------------
CREATE TABLE attendance (
  id          VARCHAR(40)  NOT NULL,
  student_nis VARCHAR(20)  NOT NULL,
  class_id    VARCHAR(20)  NULL,
  `date`      DATE         NOT NULL,
  `time`      TIME         NULL,
  subject     VARCHAR(100) NOT NULL DEFAULT '',
  status      ENUM('Hadir','Terlambat','Izin','Sakit','Alpa') NOT NULL,
  note        VARCHAR(255) NOT NULL DEFAULT '',
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_attendance_student_date_subject (student_nis, `date`, subject),
  KEY idx_attendance_date (`date`),
  KEY idx_attendance_class_date (class_id, `date`),
  CONSTRAINT fk_attendance_student FOREIGN KEY (student_nis) REFERENCES students (nis)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_attendance_class FOREIGN KEY (class_id) REFERENCES classes (id)
    ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB;

-- ---------------------------------------------------------
-- permissions : pengajuan izin / sakit / alpa dari siswa
-- ---------------------------------------------------------
CREATE TABLE permissions (
  id          VARCHAR(20)  NOT NULL,
  student_nis VARCHAR(20)  NOT NULL,
  class_id    VARCHAR(20)  NULL,
  `date`      DATE         NOT NULL,
  type        ENUM('Izin','Sakit','Alpa') NOT NULL,
  note        VARCHAR(255) NOT NULL DEFAULT '',
  status      ENUM('Menunggu','Disetujui','Ditolak') NOT NULL DEFAULT 'Menunggu',
  reviewed_by VARCHAR(20)  NULL,
  reviewed_at TIMESTAMP    NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_permissions_student_date (student_nis, `date`),
  KEY idx_permissions_status (status),
  CONSTRAINT fk_permissions_student FOREIGN KEY (student_nis) REFERENCES students (nis)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_permissions_class FOREIGN KEY (class_id) REFERENCES classes (id)
    ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_permissions_reviewer FOREIGN KEY (reviewed_by) REFERENCES users (id)
    ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB;

-- ---------------------------------------------------------
-- calendar_events : agenda akademik dan hari libur
-- ---------------------------------------------------------
CREATE TABLE calendar_events (
  id          VARCHAR(40)  NOT NULL,
  title       VARCHAR(120) NOT NULL,
  type        VARCHAR(30)  NOT NULL DEFAULT 'Akademik',
  start_date  DATE         NOT NULL,
  end_date    DATE         NOT NULL,
  description TEXT         NOT NULL,
  is_holiday  BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_calendar_dates (start_date, end_date)
) ENGINE=InnoDB;

-- ---------------------------------------------------------
-- audit_logs : catatan append-only untuk aktivitas penting
-- ---------------------------------------------------------
CREATE TABLE audit_logs (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_id    VARCHAR(20)  NOT NULL,
  actor_name  VARCHAR(100) NOT NULL,
  actor_role  ENUM('admin','guru') NOT NULL,
  action      VARCHAR(30)  NOT NULL,
  entity      VARCHAR(60)  NOT NULL,
  entity_id   VARCHAR(100) NOT NULL DEFAULT '',
  summary     VARCHAR(500) NOT NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_audit_created (created_at),
  KEY idx_audit_actor (actor_id, created_at)
) ENGINE=InnoDB;
