@echo off
REM ============================================================
REM  Ruyin 一键启动（dev 模式）
REM  ------------------------------------------------------------
REM  daemon 用 Node 拉起（SAC 放行）。窗口分两种：
REM   · 首次：普通 Edge 标签页打开 —— header 右上会出现「安装桌面应用」，
REM     点一次装成 PWA，从此得到「合并单条标题栏」（系统窗口按钮悬浮在应用
REM     header 右角，与 Claude/VS Code 同款）。
REM   · 装过之后：直接双击开始菜单/桌面的「如影 Ruyin」图标即可，无需本脚本
REM     的浏览器（daemon 仍需在跑，即本命令行窗口开着）。
REM  关掉本命令行窗口 = 停 daemon。
REM ============================================================
setlocal
set "PATH=C:\nvm4w\nodejs;%PATH%"
set "REPO=%~dp0"
set "RUYIN_PORT=7420"
set "RUYIN_TOKEN=ruyin-local"
set "RUYIN_PRODUCTS_DIR=%REPO%products"
set "RUYIN_UI_DIR=%REPO%apps\ui-workspace\dist"

echo [ruyin] daemon starting on http://127.0.0.1:%RUYIN_PORT% ...
start "" /min cmd /c "timeout /t 2 /nobreak >nul & start "" "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" http://127.0.0.1:%RUYIN_PORT%/?token=%RUYIN_TOKEN% --no-proxy-server"
node "%REPO%apps\local-host\dist\main.js"
