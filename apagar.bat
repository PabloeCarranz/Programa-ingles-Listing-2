@echo off
setlocal
title Listening - Apagar
set BACK_PORT=8002
set FRONT_PORT=5174

echo =============================================
echo   Listening - Apagando servidores
echo =============================================
echo.
echo Cerrando lo que usa los puertos %BACK_PORT% (backend) y %FRONT_PORT% (frontend)...
powershell -NoProfile -Command "foreach ($p in %BACK_PORT%,%FRONT_PORT%) { Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } }"

rem Cierra tambien las ventanas negras que abrio iniciar.bat
taskkill /FI "WINDOWTITLE eq Listening-Backend*" /T /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq Listening-Frontend*" /T /F >nul 2>&1

echo.
echo Listo, servidores apagados.
timeout /t 3 /nobreak >nul
