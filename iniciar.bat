@echo off
setlocal
title Listening - Ingles
set PORT=8002
set LISTENING_PORT=%PORT%
cd /d "%~dp0"

rem Si lo instalo Instalar-Listening.exe, el Python propio del programa esta en "venv"
set PY="python"
if exist "%~dp0venv\Scripts\python.exe" set PY="%~dp0venv\Scripts\python.exe"
if not exist "%~dp0venv\Scripts\python.exe" where python >nul 2>&1 || (echo.& echo [!] No encuentro Python. Instalalo desde python.org y volve a abrir este archivo.& pause & exit /b 1)

rem La pantalla ya viene compilada (frontend\dist). Solo si falta hace falta Node.js para armarla.
if exist "%~dp0frontend\dist\index.html" goto front_ok
where npm >nul 2>&1 || (echo.& echo [!] Falta la carpeta frontend\dist y no hay Node.js para armarla. Reinstala el programa o instala Node.js desde nodejs.org.& pause & exit /b 1)
echo [*] Armando la pantalla, solo esta vez...
pushd "%~dp0frontend"
if not exist node_modules\vite\ call npm install
call npm run build
popd
if not exist "%~dp0frontend\dist\index.html" (echo [!] No se pudo armar la pantalla. Mira el error de arriba.& pause & exit /b 1)
:front_ok

where ffmpeg >nul 2>&1 || echo [aviso] No encuentro ffmpeg en el PATH: para exportar videos con subtitulos hace falta (version "full" de gyan.dev).

rem La primera vez en una compu nueva instala lo que falte (despues ya no tarda nada)
%PY% -c "import fastapi, uvicorn, multipart, yt_dlp, PIL" >nul 2>&1 && goto back_ok
echo.
echo [*] Instalando lo que falta, solo la primera vez: puede tardar varios minutos...
%PY% -m pip install -r "%~dp0backend\requirements.txt"
if errorlevel 1 (echo.& echo [!] No se pudo instalar lo que falta. Mira el error de arriba.& pause & exit /b 1)
:back_ok

rem Cierra la version anterior (solo lo que usa el puerto de esta app)
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"
timeout /t 1 /nobreak >nul

rem Arranca el programa sin ventana (lo que imprime queda en listening.log) y abre el navegador cuando responde
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0lanzar.ps1" -Python %PY% -Port %PORT%
if errorlevel 1 (echo.& echo [!] El programa no pudo arrancar. Detalle en listening.log.err & pause & exit /b 1)
exit /b 0
