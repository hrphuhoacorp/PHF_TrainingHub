@echo off
setlocal
cd /d "%~dp0"
echo.
echo ==============================================
echo   PHF TRAINING HUB - SAO LUU SUPABASE
 echo ==============================================
echo.
node scripts\phf-backup-supabase.js
set "EXIT_CODE=%ERRORLEVEL%"
echo.
if not "%EXIT_CODE%"=="0" (
  echo Sao luu KHONG thanh cong. Khong co du lieu nao bi thay doi.
) else (
  echo Hoan tat. Mo thu muc backups\supabase de xem ban sao luu.
)
echo.
pause
exit /b %EXIT_CODE%
