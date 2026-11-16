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
echo Instala Python y ffmpeg si faltan, y despues lo que usa el programa.
echo La primera vez puede tardar bastante (descarga varios cientos de MB). No cierres esta ventana.
echo.

echo [1/5] Copiando el programa...
if not exist "%DEST%" mkdir "%DEST%"
powershell -NoProfile -Command "Expand-Archive -LiteralPath '%SRC%app.zip' -DestinationPath '%DEST%' -Force"
if errorlevel 1 (echo [!] No se pudo copiar el programa.& goto fail)

where winget >nul 2>&1 || set NOWINGET=1

echo.
echo [2/5] Python...
set "PYEXE="
call :findpython
if defined PYEXE goto py_ok
echo Instalando Python 3.12...
if defined NOWINGET goto py_direct
winget install -e --id Python.Python.3.12 --silent --accept-package-agreements --accept-source-agreements
call :refreshpath
call :findpython
if defined PYEXE goto py_ok
:py_direct
rem Sin winget (o si fallo): se baja el instalador oficial de python.org y se instala solo para este usuario
echo Descargando Python desde python.org...
call :download "https://www.python.org/ftp/python/3.12.10/python-3.12.10-amd64.exe" "%TEMP%\listening-python.exe"
if errorlevel 1 goto py_err
"%TEMP%\listening-python.exe" /quiet InstallAllUsers=0 PrependPath=1 Include_launcher=0 Include_test=0
del "%TEMP%\listening-python.exe" >nul 2>&1
call :refreshpath
call :findpython
:py_err
if not defined PYEXE (echo [!] No se pudo instalar Python. Instalalo a mano desde python.org ^(3.12, tildando "Add to PATH"^) y volve a abrir este instalador.& goto fail)
:py_ok
echo Usando %PYEXE%

echo.
echo [3/5] ffmpeg...
if exist "%DEST%\ffmpeg\bin\ffmpeg.exe" goto ff_ok
where ffmpeg >nul 2>&1 && goto ff_ok
if defined NOWINGET goto ff_direct
winget install -e --id Gyan.FFmpeg --silent --accept-package-agreements --accept-source-agreements
call :refreshpath
where ffmpeg >nul 2>&1 && goto ff_ok
:ff_direct
rem Sin winget (o si fallo): se baja de gyan.dev y queda dentro de la carpeta del programa
echo Descargando ffmpeg desde gyan.dev...
call :download "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip" "%TEMP%\listening-ffmpeg.zip"
if errorlevel 1 goto ff_err
powershell -NoProfile -Command "$t=Join-Path $env:TEMP 'listening-ffmpeg'; if(Test-Path $t){Remove-Item $t -Recurse -Force}; Expand-Archive -LiteralPath (Join-Path $env:TEMP 'listening-ffmpeg.zip') -DestinationPath $t -Force; $b=Get-ChildItem $t -Recurse -Filter ffmpeg.exe | Select-Object -First 1; New-Item -ItemType Directory -Force '%DEST%\ffmpeg\bin' | Out-Null; Copy-Item (Join-Path $b.DirectoryName '*') '%DEST%\ffmpeg\bin' -Force; Remove-Item $t -Recurse -Force"
del "%TEMP%\listening-ffmpeg.zip" >nul 2>&1
:ff_err
if not exist "%DEST%\ffmpeg\bin\ffmpeg.exe" echo [aviso] No se pudo instalar ffmpeg. El programa anda, pero exportar videos con subtitulos puede fallar.
:ff_ok

echo.
echo [4/5] Dependencias del programa (la parte mas lenta)...
if not exist "%DEST%\venv\Scripts\python.exe" "%PYEXE%" -m venv "%DEST%\venv"
if errorlevel 1 (echo [!] No se pudo preparar Python.& goto fail)
"%DEST%\venv\Scripts\python.exe" -m pip install --upgrade pip
"%DEST%\venv\Scripts\python.exe" -m pip install -r "%DEST%\backend\requirements.txt"
if errorlevel 1 (echo [!] No se pudieron instalar las dependencias. Mira el error de arriba.& goto fail)

echo [5/5] Creando accesos directos en el escritorio...
powershell -NoProfile -Command "$s=New-Object -ComObject WScript.Shell; foreach($n in 'iniciar','apagar'){ $t = if($n -eq 'iniciar'){'Listening'}else{'Listening - Apagar'}; $l=$s.CreateShortcut([Environment]::GetFolderPath('Desktop')+'\'+$t+'.lnk'); $l.TargetPath='%DEST%\'+$n+'.bat'; $l.WorkingDirectory='%DEST%'; $l.IconLocation='%DEST%\assets\listening.ico'; $l.Save() }"

echo.
echo =============================================
echo   Listo! Abri "Listening" desde el escritorio.
echo =============================================
choice /c SN /m "Abrirlo ahora"
if errorlevel 2 exit /b 0
start "" "%DEST%\iniciar.bat"
exit /b 0

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

:download
rem %1 = URL, %2 = archivo destino. TLS 1.2 a mano porque en Windows viejos PowerShell no lo usa solo.
powershell -NoProfile -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; $ProgressPreference='SilentlyContinue'; try { Invoke-WebRequest -UseBasicParsing -Uri '%~1' -OutFile '%~2' } catch { Write-Host $_.Exception.Message; exit 1 }"
if errorlevel 1 (echo [!] No se pudo descargar %~1 ^(revisa la conexion a internet^).& exit /b 1)
exit /b 0

:refreshpath
for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('Path','Machine')+';'+[Environment]::GetEnvironmentVariable('Path','User')"`) do set "PATH=%%P"
exit /b 0
