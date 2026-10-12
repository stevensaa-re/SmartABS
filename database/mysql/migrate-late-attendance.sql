ALTER TABLE attendance
  ADD COLUMN subject VARCHAR(100) NOT NULL DEFAULT '' AFTER `time`,
  DROP INDEX uq_attendance_student_date,
  ADD UNIQUE KEY uq_attendance_student_date_subject (student_nis, `date`, subject),
  MODIFY status ENUM('Hadir', 'Terlambat', 'Izin', 'Sakit', 'Alpa') NOT NULL;
