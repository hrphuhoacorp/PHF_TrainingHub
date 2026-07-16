@echo off
chcp 65001 >nul
title PHF - Kiem tra bang tai khoan Supabase
cd /d "%~dp0"
node scripts\phf-check-user-accounts.js
echo.
pause
