@echo off
title COGM - Setup Database MySQL
color 0A
echo.
echo  ============================================
echo   COGM - Setup Database di XAMPP MySQL
echo  ============================================
echo.
echo  Pastikan XAMPP sudah dijalankan dan MySQL sudah START
echo.

:: Try with empty password (XAMPP default)
mysql -u root -e "CREATE DATABASE IF NOT EXISTS cogm_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;" 2>nul
if %errorlevel% equ 0 (
  echo  [OK] Database cogm_db berhasil dibuat (password kosong)
  goto :done
)

:: Ask for password
set /p PASS=Password root MySQL (kosongkan jika tidak ada): 
mysql -u root -p%PASS% -e "CREATE DATABASE IF NOT EXISTS cogm_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
if %errorlevel% neq 0 (
  echo  [ERROR] Gagal membuat database. Coba import cogm_setup.sql manual di phpMyAdmin.
  pause & exit /b 1
)

:done
echo.
echo  [OK] Database cogm_db siap!
echo.
echo  Langkah selanjutnya:
echo  1. Jalankan START.bat untuk menjalankan server
echo  2. Jika ada data lama di cogm.json, jalankan: MIGRATE.bat
echo.
pause
