@echo off
setlocal
title Listening - Ingles
set BACK_PORT=8002
set FRONT_PORT=5174
set LISTENING_PORT=%BACK_PORT%

echo =============================================
echo   Listening - Ingles
echo =============================================

where python >nul 2>&1 || (echo.& echo [!] No encuentro Python. Instalalo desde python.org y volve a abrir este archivo.& pause & exit /b 1)
where node   >nul 2>&1 || (echo.& echo [!] No encuentro Node.js. Instalalo desde nodejs.org y volve a abrir este archivo.& pause & exit /b 1)
where ffmpeg >nul 2>&1 || echo [aviso] No encuentro ffmpeg en el PATH: para exportar videos con subtitulos hace falta (version "full" de gyan.dev).

rem La primera vez en una compu nueva instala lo que falte (despues ya no tarda nada)
python -c "import fastapi, uvicorn, multipart, yt_dlp, PIL" >nul 2>&1 && goto back_ok
echo.
echo [*] Instalando lo que falta del backend, solo la primera vez: puede tardar varios minutos...
python -m pip install -r "%~dp0backend\requirements.txt"
if errorlevel 1 (echo.& echo [!] No se pudo instalar lo del backend. Mira el error de arriba.& pause & exit /b 1)
:back_ok
if exist "%~dp0frontend\node_modules\vite\" goto front_ok
echo.
echo [*] Instalando el frontend, solo la primera vez...
pushd "%~dp0frontend"
call npm install
if errorlevel 1 (popd & echo.& echo [!] No se pudo instalar el frontend. Mira el error de arriba.& pause & exit /b 1)
popd
:front_ok

echo.
echo [0/2] Cerrando la version anterior (solo lo que usa los puertos %BACK_PORT% y %FRONT_PORT%)...
powershell -NoProfile -Command "foreach ($p in %BACK_PORT%,%FRONT_PORT%) { Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } }"
timeout /t 2 /nobreak >nul

echo [1/2] Iniciando backend...
start "Listening-Backend" cmd /k "cd /d "%~dp0backend" && python main.py"

echo [2/2] Iniciando frontend...
timeout /t 3 /nobreak >nul
start "Listening-Frontend" cmd /k "cd /d "%~dp0frontend" && npm run dev"

echo.
echo =============================================
echo   Listo! Abriendo en http://localhost:%FRONT_PORT%
echo =============================================
timeout /t 4 /nobreak >nul
start http://localhost:%FRONT_PORT%
