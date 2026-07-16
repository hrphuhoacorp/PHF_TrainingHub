@echo off
chcp 65001 >nul
title PHF - Kiem tra bang BMTT Supabase
cd /d "%~dp0"
node scripts\phf-check-commitment-records.js
echo.
pause
