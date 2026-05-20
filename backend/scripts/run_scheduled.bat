@echo off
REM ===============================================================
REM run_scheduled.bat -- QuantEdge daily pipeline runner (Windows)
REM ===============================================================
REM Called by Windows Task Scheduler. Equivalent to `npm run refresh-data`
REM but with proper cwd, venv lookup, and log redirection to cron.log.
REM
REM Usage (register to Task Scheduler):
REM   Action  = This .bat file
REM   Trigger = Weekly, Mon-Fri, 16:30 (or post-close in your timezone)
REM
REM Log:
REM   backend\output\cron.log  (appended; check there if scheduled run failed)

setlocal

REM cd to project root (script lives in backend\scripts\, two levels up)
cd /d "%~dp0..\.."

REM Pick python: prefer venv, fall back to PATH
set PYTHON_BIN=backend\.venv\Scripts\python.exe
if not exist "%PYTHON_BIN%" set PYTHON_BIN=python

REM Ensure output dir exists (pipeline.py also creates it, this is belt+suspenders)
if not exist "backend\output" mkdir "backend\output"

REM Stamp the log so multiple runs are distinguishable
echo. >> backend\output\cron.log
echo === QuantEdge run at %date% %time% === >> backend\output\cron.log

REM Run pipeline; pipe stdout+stderr to cron.log (pipeline.py already
REM reconfigures stdout to UTF-8 so glyphs like checkmarks survive GBK cmd)
"%PYTHON_BIN%" backend\pipeline.py >> backend\output\cron.log 2>&1

set EXIT=%ERRORLEVEL%
echo === Exit code: %EXIT% === >> backend\output\cron.log
exit /b %EXIT%
