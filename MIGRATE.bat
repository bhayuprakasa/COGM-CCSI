@echo off
title COGM - Migrasi Data cogm.json ke MySQL
color 0A
echo.
echo  ============================================
echo   COGM - Migrasi Data JSON ke MySQL
echo  ============================================
echo.
echo  Script ini akan memindahkan data dari data\cogm.json ke MySQL.
echo  Pastikan:
echo    1. XAMPP MySQL sudah START
echo    2. setup-db.bat sudah dijalankan
echo    3. File data\cogm.json ada
echo.
pause

cd /d "%~dp0"
node scripts/migrate.js
echo.
pause
