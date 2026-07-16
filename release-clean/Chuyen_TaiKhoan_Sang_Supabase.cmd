@echo off
chcp 65001 >nul
title PHF - Chuyen tai khoan sang Supabase
cd /d "%~dp0"
node scripts\phf-migrate-user-accounts-to-supabase.js
echo.
pause
