# Arma Instalar-Listening.exe (usa IExpress, que ya viene con Windows). Correr desde cualquier lado:
#   powershell -ExecutionPolicy Bypass -File instalador\crear-instalador.ps1
$ErrorActionPreference = 'Stop'
$root  = Split-Path -Parent $PSScriptRoot
$work  = Join-Path $env:TEMP 'listening_installer'
$out   = Join-Path $root 'Instalar-Listening.exe'
if (Test-Path $work) { Remove-Item $work -Recurse -Force }
New-Item -ItemType Directory "$work\app", "$work\pkg" | Out-Null

# El programa sin lo que se regenera o es personal
robocopy $root "$work\app" /E /XD .git node_modules dist __pycache__ .pytest_cache videos venv instalador /XF .env config.json *.pyc Instalar-Listening.exe *.zip /NFL /NDL /NJH /NJS | Out-Null
Compress-Archive -Path "$work\app\*" -DestinationPath "$work\pkg\app.zip"
Copy-Item "$PSScriptRoot\instalar.bat" "$work\pkg\instalar.bat"

$sed = @"
[Version]
Class=IEXPRESS
SEDVersion=3
[Options]
PackagePurpose=InstallApp
ShowInstallProgramWindow=0
HideExtractAnimation=1
UseLongFileName=1
InsideCompressed=0
CAB_FixedSize=0
CAB_ResvCodeSigning=0
RebootMode=N
InstallPrompt=%InstallPrompt%
DisplayLicense=%DisplayLicense%
FinishMessage=%FinishMessage%
TargetName=%TargetName%
FriendlyName=%FriendlyName%
AppLaunched=%AppLaunched%
PostInstallCmd=%PostInstallCmd%
AdminQuietInstCmd=%AdminQuietInstCmd%
UserQuietInstCmd=%UserQuietInstCmd%
SourceFiles=SourceFiles
[Strings]
InstallPrompt=
DisplayLicense=
FinishMessage=
TargetName=$out
FriendlyName=Listening - Instalador
AppLaunched=cmd /c instalar.bat
PostInstallCmd=<None>
AdminQuietInstCmd=
UserQuietInstCmd=
FILE0="instalar.bat"
FILE1="app.zip"
[SourceFiles]
SourceFiles0=$work\pkg\
[SourceFiles0]
%FILE0%=
%FILE1%=
"@
Set-Content "$work\listening.sed" $sed -Encoding ASCII
if (Test-Path $out) { Remove-Item $out }
Start-Process iexpress.exe -ArgumentList '/N', '/Q', "$work\listening.sed" -Wait
if (-not (Test-Path $out)) { throw 'IExpress no genero el .exe' }
Get-Item $out | Select-Object FullName, @{n='MB'; e={[math]::Round($_.Length/1MB, 1)}}
