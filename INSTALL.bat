@echo off
title COGM - Install dan Setup
color 0A
echo.
echo  ============================================
echo   COGM Manufacturing BOM System - Installer
echo  ============================================
echo.

:: Check Node.js
node -v >nul 2>&1
if %errorlevel% neq 0 (
  echo  [ERROR] Node.js belum terinstall!
  echo.
  echo  Silakan download dan install Node.js dari:
  echo  https://nodejs.org  (pilih versi LTS)
  echo.
  echo  Setelah install Node.js, jalankan install.bat lagi.
  pause
  exit /b 1
)

echo  [OK] Node.js ditemukan:
node -v
echo.

:: Install dependencies
echo  Menginstall dependencies...
npm install
if %errorlevel% neq 0 (
  echo  [ERROR] Gagal install dependencies.
  pause
  exit /b 1
)
echo  [OK] Dependencies terinstall.
echo.

:: Create folders
if not exist "public" mkdir public
if not exist "data" mkdir data
if not exist "data\backups" mkdir data\backups
echo  [OK] Folder dibuat.
echo.

:: Copy frontend
if exist "bom-system.html" (
  copy /Y bom-system.html public\index.html
  echo  [OK] Frontend disalin ke public\index.html
) else (
  echo  [INFO] File bom-system.html tidak ditemukan di folder ini.
  echo         Salin manual bom-system.html ke folder public\ dan rename jadi index.html
)
echo.

echo  ============================================
echo   Instalasi selesai!
echo  ============================================
echo.
echo  Untuk menjalankan server: jalankan START.bat
echo.
pause
