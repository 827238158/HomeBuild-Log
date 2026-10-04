@echo off
setlocal
rem 将引擎缓存固定在项目内，避免占用用户目录。
for %%I in ("%~dp0..") do set "project_root=%%~fI"
set "IMPECCABLE_HOME=%project_root%\.local-artifacts\impeccable"
set "IMPECCABLE_SKILL_DIR=%project_root%\.agents\skills\impeccable"
rem 首次安装与更新需按接入文档准备引擎；本入口不自动下载。
set "engine_version="
set /p engine_version=<"%IMPECCABLE_SKILL_DIR%\scripts\VERSION"
set "IMPECCABLE_BIN=%IMPECCABLE_HOME%\bin\%engine_version%\impeccable.exe"
if not exist "%IMPECCABLE_BIN%" goto missing
call "%IMPECCABLE_SKILL_DIR%\scripts\impeccable.cmd" %*
exit /b %errorlevel%
:missing
echo Impeccable engine missing. See docs/impeccable.md for project-local setup. 1>&2
exit /b 127
