@echo off
setlocal
title Listening - Apagar
set PORT=8002
set FRONT_PORT=5174

echo Apagando Listening...
rem Cierra lo que usa el puerto del programa (y el del modo desarrollo, si estaba abierto)
powershell -NoProfile -Command "foreach ($p in %PORT%,%FRONT_PORT%) { Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } }"
taskkill /FI "WINDOWTITLE eq Listening-Backend*" /T /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq Listening-Frontend*" /T /F >nul 2>&1
echo Listo.
timeout /t 2 /nobreak >nul
