@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

if not exist ".server.pid" (
  echo 실행 중인 서버가 없습니다.
  timeout /t 2 >nul
  exit /b 0
)

set /p PID=<.server.pid

rem PID 가 재사용되어 다른 프로그램이 되었을 수 있으니 node.exe 인지 먼저 확인한다
tasklist /FI "PID eq %PID%" /FI "IMAGENAME eq node.exe" 2>nul | find "node.exe" >nul
if errorlevel 1 (
  echo 이미 종료된 서버입니다. 상태 파일을 정리합니다.
  del ".server.pid" ".server.port" >nul 2>&1
  timeout /t 2 >nul
  exit /b 0
)

rem /T: 서버가 띄운 CLI 자식 프로세스까지 함께 종료
taskkill /PID %PID% /T /F >nul 2>&1
del ".server.pid" ".server.port" >nul 2>&1
echo 3 Agents 서버를 종료했습니다.
timeout /t 2 >nul
exit /b 0
