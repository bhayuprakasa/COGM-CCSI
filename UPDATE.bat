@echo off
title COGM Updater
color 0B
echo.
echo  ============================================
echo   COGM Auto Update
echo  ============================================
echo.

cd /d "%~dp0"

:: Stop server yang sedang berjalan di port 3001
echo  [1/3] Menghentikan server lama (port 3001)...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3001 ^| findstr LISTENING') do (
  taskkill /PID %%a /F >nul 2>&1
)
echo  Server dihentikan.
echo.

:: Pull update terbaru
echo  [2/3] Mengambil update dari GitHub...
git pull origin main
if errorlevel 1 (
  echo  [ERROR] git pull gagal! Periksa koneksi internet.
  pause
  exit /b 1
)
echo.

:: Restart server
echo  [3/3] Menjalankan server baru...
echo.
start "COGM Server" node server.js

echo  ============================================
echo   Update selesai! Server berjalan di :3001
echo  ============================================
echo.
timeout /t 3
