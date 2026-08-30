@echo off
REM ============================================================
REM  Ruyin 一键启动（dev 模式，已在本机验证的路径）
REM  ------------------------------------------------------------
REM  daemon 用 Node 拉起（SAC 放行）；窗口用 Edge 应用模式（独立无
REM  地址栏窗口，--no-proxy-server 绕过浏览器代理，本机 127.0.0.1
REM  直连）。关掉本命令行窗口 = 停 daemon。
REM ============================================================
setlocal
set "PATH=C:\nvm4w\nodejs;%PATH%"
set "REPO=%~dp0"
set "RUYIN_PORT=7420"
set "RUYIN_TOKEN=ruyin-local"
set "RUYIN_PRODUCTS_DIR=%REPO%products"
set "RUYIN_UI_DIR=%REPO%apps\ui-workspace\dist"

echo [ruyin] daemon starting on http://127.0.0.1:%RUYIN_PORT% ...
start "" /min cmd /c "timeout /t 2 /nobreak >nul & start "" "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" --app=http://127.0.0.1:%RUYIN_PORT%/?token=%RUYIN_TOKEN% --no-proxy-server --new-window"
node "%REPO%apps\local-host\dist\main.js"
