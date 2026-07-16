@echo off
chcp 65001 >nul
title PHF - Kiem tra tai khoan Vercel Supabase
cd /d "%~dp0"
node scripts\phf-check-vercel-auth-accounts.js
echo.
pause
