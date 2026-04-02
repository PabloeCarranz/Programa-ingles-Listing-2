@echo off
echo =============================================
echo   Listening - Ingles
echo =============================================

echo.
echo [0/2] Cerrando procesos anteriores...
taskkill /F /IM python.exe >nul 2>&1
taskkill /F /IM python3.exe >nul 2>&1
timeout /t 2 /nobreak >nul

echo [1/2] Iniciando backend...
start "Listening-Backend" cmd /k "cd /d "%~dp0backend" && python main.py"

echo [2/2] Iniciando frontend...
timeout /t 3 /nobreak >nul
start "Listening-Frontend" cmd /k "cd /d "%~dp0frontend" && npm run dev"

echo.
echo =============================================
echo   Listo! Abriendo en http://localhost:5174
echo =============================================
timeout /t 4 /nobreak >nul
start http://localhost:5174
