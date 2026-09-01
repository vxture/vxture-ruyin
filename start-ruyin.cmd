@echo off
REM ============================================================
REM  Ruyin 启动（开发模式）
REM  ------------------------------------------------------------
REM  这个脚本只做一件事：**以桌面应用的方式启动如影**。
REM
REM  如影的主体是本地运行时（守护进程）。桌面应用（Electron 壳）会自己
REM  拉起它、也会在退出时带走它——所以入口只有这一个。
REM
REM  正式安装包：apps\shell\release\Ruyin-Setup-<version>.exe
REM  装过之后从开始菜单启动，不需要本脚本。
REM
REM  浏览器访问仍然可用（守护进程在跑时打开 http://127.0.0.1:7420/），
REM  那是**访问方式**，不是第二个应用：它不启动运行时。
REM ============================================================
setlocal
set "REPO=%~dp0"
cd /d "%REPO%"

if not exist "%REPO%apps\shell\dist\main.js" goto :notbuilt
if not exist "%REPO%apps\local-host\dist\main.js" goto :notbuilt
if not exist "%REPO%apps\ui-workspace\dist\index.html" goto :notbuilt

echo [ruyin] 正在以桌面应用方式启动...
call pnpm --filter @vxture/ruyin-shell start
goto :eof

:notbuilt
echo.
echo [ruyin] 还没构建过，先执行一次：
echo.
echo     pnpm install
echo     pnpm -r build
echo.
echo 然后重新运行本脚本。
exit /b 1
