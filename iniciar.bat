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
