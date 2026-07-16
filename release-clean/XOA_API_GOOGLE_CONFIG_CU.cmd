@echo off
chcp 65001 >nul
cd /d "%~dp0"
if exist "api\auth\google\config.js" (
  del /f /q "api\auth\google\config.js"
  echo Da xoa api\auth\google\config.js de dung gioi han 12 Vercel Functions.
) else (
  echo Khong con file api\auth\google\config.js - khong can xoa.
)
pause
