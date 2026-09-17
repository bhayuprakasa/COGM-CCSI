@echo off
title COGM - Backup Database
echo.
echo Menjalankan backup database...
node scripts/backup.js
echo.
echo Backup selesai. File tersimpan di: data\backups\
pause
