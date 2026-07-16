@echo off
chcp 65001 >nul
title PHF - Kiem tra Thu viec va Thong bao
cd /d "%~dp0"
node scripts\phf-check-probation-notifications.js
echo.
pause
