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
-- classes : data kelas
-- ---------------------------------------------------------
CREATE TABLE classes (
  id        VARCHAR(20)  NOT NULL,
  name      VARCHAR(50)  NOT NULL,
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
  class_id VARCHAR(20)  NOT NULL,
  gender   ENUM('L','P') NOT NULL DEFAULT 'L',
  status   ENUM('Aktif','Nonaktif') NOT NULL DEFAULT 'Aktif',
  user_id  VARCHAR(20)  NULL,
  phone    VARCHAR(30)  NOT NULL DEFAULT '',
  PRIMARY KEY (nis),
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
-- attendance : absensi harian. SATU baris per siswa per tanggal.
-- class_id adalah "snapshot" kelas saat absensi dicatat, sehingga
-- riwayat tetap benar walaupun siswa kemudian pindah kelas.
-- ---------------------------------------------------------
CREATE TABLE attendance (
  id          VARCHAR(40)  NOT NULL,
  student_nis VARCHAR(20)  NOT NULL,
  class_id    VARCHAR(20)  NULL,
  `date`      DATE         NOT NULL,
  `time`      TIME         NULL,
  status      ENUM('Hadir','Izin','Sakit','Alpa') NOT NULL,
  note        VARCHAR(255) NOT NULL DEFAULT '',
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_attendance_student_date (student_nis, `date`),
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
