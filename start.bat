@echo off
cd /d "%~dp0"
if not exist node_modules call npm install
echo.
echo Open this on your phone (same Wi-Fi):  http://YOUR-IP:3000   (find YOUR-IP with ipconfig)
echo.
call npm run dev
pause
