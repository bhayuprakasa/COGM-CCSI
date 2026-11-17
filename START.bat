@echo off
title COGM Server - Manufacturing BOM System
color 0A
echo.
echo  ============================================
echo   COGM Server Starting...
echo  ============================================
echo.
echo  Pastikan XAMPP MySQL sudah START sebelum melanjutkan.
echo.

cd /d "%~dp0"

:: ── Auto-pull update terbaru dari GitHub ──
echo  [UPDATE] Mengambil update terbaru dari GitHub...
git pull origin main
if errorlevel 1 (
  echo  [WARNING] git pull gagal - mungkin tidak ada koneksi internet.
  echo  Melanjutkan dengan versi lokal...
)
echo.

node server.js
pause
