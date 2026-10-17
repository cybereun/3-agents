@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 3 Agents 서버를 시작합니다. 이 창을 닫으면 종료됩니다.
node server.js --open
pause
