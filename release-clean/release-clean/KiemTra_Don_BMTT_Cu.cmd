@echo off
chcp 65001 >nul
title PHF - Kiem tra don BMTT cu
cd /d "%~dp0"
node scripts\phf-check-legacy-bmtt-cleanup.js
echo.
pause
