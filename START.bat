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
node server.js
pause
