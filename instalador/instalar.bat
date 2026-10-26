@echo off
setlocal
title Listening - Instalador
set "SRC=%~dp0"
set "DEST=%LOCALAPPDATA%\Listening"

echo =============================================
echo   Listening - Instalador
echo =============================================
echo.
echo Se instala en: %DEST%
echo Instala Python, Node.js y ffmpeg si faltan, y despues lo que usa el programa.
echo La primera vez puede tardar bastante (descarga varios cientos de MB). No cierres esta ventana.
echo.

echo [1/6] Copiando el programa...
if not exist "%DEST%" mkdir "%DEST%"
powershell -NoProfile -Command "Expand-Archive -LiteralPath '%SRC%app.zip' -DestinationPath '%DEST%' -Force"
if errorlevel 1 (echo [!] No se pudo copiar el programa.& goto fail)

where winget >nul 2>&1 || set NOWINGET=1

echo.
echo [2/6] Python...
set "PYEXE="
call :findpython
if defined PYEXE goto py_ok
if defined NOWINGET goto nowinget
echo Instalando Python 3.12...
winget install -e --id Python.Python.3.12 --silent --accept-package-agreements --accept-source-agreements
call :refreshpath
call :findpython
if not defined PYEXE (echo [!] No se pudo instalar Python. Instalalo a mano desde python.org y volve a abrir este instalador.& goto fail)
:py_ok
echo Usando %PYEXE%

echo.
echo [3/6] Node.js...
where node >nul 2>&1 && goto node_ok
if defined NOWINGET goto nowinget
winget install -e --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
call :refreshpath
where node >nul 2>&1 || (echo [!] No se pudo instalar Node.js. Instalalo a mano desde nodejs.org y volve a abrir este instalador.& goto fail)
:node_ok

echo.
echo [4/6] ffmpeg...
where ffmpeg >nul 2>&1 && goto ff_ok
if defined NOWINGET goto ff_ok
winget install -e --id Gyan.FFmpeg --silent --accept-package-agreements --accept-source-agreements
call :refreshpath
where ffmpeg >nul 2>&1 || echo [aviso] No se pudo instalar ffmpeg. El programa anda, pero exportar videos con subtitulos puede fallar.
:ff_ok

echo.
echo [5/6] Dependencias del programa (la parte mas lenta)...
if not exist "%DEST%\venv\Scripts\python.exe" "%PYEXE%" -m venv "%DEST%\venv"
if errorlevel 1 (echo [!] No se pudo preparar Python.& goto fail)
"%DEST%\venv\Scripts\python.exe" -m pip install --upgrade pip
"%DEST%\venv\Scripts\python.exe" -m pip install -r "%DEST%\backend\requirements.txt"
if errorlevel 1 (echo [!] No se pudieron instalar las dependencias. Mira el error de arriba.& goto fail)
pushd "%DEST%\frontend"
call npm install
if errorlevel 1 (popd & echo [!] No se pudo instalar el frontend. Mira el error de arriba.& goto fail)
popd

echo.
echo [6/6] Creando accesos directos en el escritorio...
powershell -NoProfile -Command "$s=New-Object -ComObject WScript.Shell; foreach($n in 'iniciar','apagar'){ $t = if($n -eq 'iniciar'){'Listening'}else{'Listening - Apagar'}; $l=$s.CreateShortcut([Environment]::GetFolderPath('Desktop')+'\'+$t+'.lnk'); $l.TargetPath='%DEST%\'+$n+'.bat'; $l.WorkingDirectory='%DEST%'; $l.IconLocation='%DEST%\assets\listening.ico'; $l.Save() }"

echo.
echo =============================================
echo   Listo! Abri "Listening" desde el escritorio.
echo =============================================
choice /c SN /m "Abrirlo ahora"
if errorlevel 2 exit /b 0
start "" "%DEST%\iniciar.bat"
exit /b 0

:nowinget
echo.
echo [!] Esta compu no tiene "winget" (App Installer de Microsoft).
echo     Instala a mano Python 3.12 (python.org, tildando "Add to PATH"), Node.js (nodejs.org) y ffmpeg full (gyan.dev)
echo     y volve a abrir este instalador.
:fail
echo.
pause
exit /b 1

:findpython
rem Sirve Python 3.10 a 3.13 (con 3.14 todavia no hay whisper/torch)
for %%P in (python.exe "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" "%LOCALAPPDATA%\Programs\Python\Python311\python.exe" "%LOCALAPPDATA%\Programs\Python\Python313\python.exe" "%LOCALAPPDATA%\Programs\Python\Python310\python.exe") do (
  if not defined PYEXE (
    %%P -c "import sys; sys.exit(0 if (3,10)<=sys.version_info[:2]<=(3,13) else 1)" >nul 2>&1 && set "PYEXE=%%~P"
  )
)
exit /b 0

:refreshpath
for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('Path','Machine')+';'+[Environment]::GetEnvironmentVariable('Path','User')"`) do set "PATH=%%P"
exit /b 0
