@echo off
rem Lance Cal-Home Alt en local : start.bat [--mock] [--lan] [--port N] [--dev] [--rebuild] [--no-browser]
cd /d "%~dp0"
where py >nul 2>nul && (py run.py %* & goto :eof)
where python >nul 2>nul && (python run.py %* & goto :eof)
echo Python 3.10+ introuvable. 1>&2
exit /b 1
