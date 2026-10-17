@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 바탕화면에 바로가기를 만듭니다...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\create-shortcuts.ps1" -Root "%~dp0."
if errorlevel 1 (
  echo.
  echo 바로가기 생성에 실패했습니다. 위 오류 문장을 확인하세요.
) else (
  echo.
  echo 완료: 바탕화면의 "3 Agents" 를 더블클릭하면 창 없이 실행됩니다.
  echo       종료는 "3 Agents Stop" 을 더블클릭하세요.
)
pause
