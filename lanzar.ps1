# Lo llama iniciar.bat: arranca el programa sin ventana y abre el navegador cuando el puerto responde.
param([string]$Python = 'python', [int]$Port = 8002)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$log  = Join-Path $root 'listening.log'
$err  = Join-Path $root 'listening.log.err'

$p = Start-Process -FilePath $Python -ArgumentList 'main.py' -WorkingDirectory (Join-Path $root 'backend') `
       -WindowStyle Hidden -RedirectStandardOutput $log -RedirectStandardError $err -PassThru
Write-Host 'Iniciando Listening...'

# Espera hasta 3 minutos (la primera vez puede tardar) a que el puerto acepte conexiones
$listo = $false
for ($i = 0; $i -lt 180 -and -not $listo; $i++) {
    Start-Sleep -Seconds 1
    if ($p.HasExited) { break }
    $c = New-Object System.Net.Sockets.TcpClient
    try { $c.Connect('127.0.0.1', $Port); $listo = $true } catch { } finally { $c.Close() }
}
if ($listo) { Start-Process "http://localhost:$Port"; exit 0 }
Write-Host 'El programa no arranco. Detalle en listening.log.err'
exit 1
