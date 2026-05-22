# Run as Administrator: Right-click -> Run with PowerShell (as Admin)
# Fixes MongoDB Error 1053 by reinstalling MongoDB 8.3.2 + VC++ runtime

$ErrorActionPreference = 'Stop'

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host 'ERROR: Run this script as Administrator.' -ForegroundColor Red
    exit 1
}

$ProductCode = '{224A0A82-7E6C-47D3-B6D3-BAD474082D49}'
$MsiUrl = 'https://fastdl.mongodb.org/windows/mongodb-windows-x86_64-8.3.2-signed.msi'
$MsiPath = Join-Path $env:TEMP 'mongodb-windows-x86_64-8.3.2-signed.msi'
$VcUrl = 'https://aka.ms/vs/17/release/vc_redist.x64.exe'
$VcPath = Join-Path $env:TEMP 'vc_redist.x64.exe'
$LogPath = Join-Path $env:TEMP 'mongodb-install.log'
$Mongod = 'C:\Program Files\MongoDB\Server\8.3\bin\mongod.exe'

Write-Host '=== MongoDB Service Fix ===' -ForegroundColor Cyan

Write-Host '[1/5] Installing Visual C++ Redistributable...'
Invoke-WebRequest -Uri $VcUrl -OutFile $VcPath -UseBasicParsing
Start-Process -FilePath $VcPath -ArgumentList '/install', '/quiet', '/norestart' -Wait

Write-Host '[2/5] Downloading MongoDB 8.3.2 MSI (if needed)...'
if (-not (Test-Path $MsiPath) -or (Get-Item $MsiPath).Length -lt 300MB) {
    Invoke-WebRequest -Uri $MsiUrl -OutFile $MsiPath -UseBasicParsing
}

Write-Host '[3/5] Stopping and removing old MongoDB...'
Stop-Service MongoDB -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
$installed = Get-ItemProperty HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\* -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -like 'MongoDB 8.3.2*' }
if ($installed) {
    Start-Process msiexec.exe -ArgumentList "/x", $ProductCode, "/qn", "/norestart" -Wait
    Start-Sleep -Seconds 5
}

Write-Host '[4/5] Installing MongoDB (mongod + Windows service)...'
# ServerService = mongod.exe + mongod.cfg + service; without this only mongos/router installs
$installArgs = @(
    '/i', "`"$MsiPath`"",
    '/qn', '/norestart',
    'ADDLOCAL=ServerService,Router,MiscellaneousTools',
    'MONGO_SERVICE_INSTALL=1',
    'SHOULD_INSTALL_COMPASS=0',
    "/l*v", "`"$LogPath`""
)
$p = Start-Process msiexec.exe -ArgumentList $installArgs -Wait -PassThru
if ($p.ExitCode -ne 0 -and $p.ExitCode -ne 3010) {
    Write-Host "Install failed. Exit code: $($p.ExitCode). Log: $LogPath" -ForegroundColor Red
    exit $p.ExitCode
}

if (-not (Test-Path $Mongod)) {
    Write-Host "mongod.exe not found after install. See log: $LogPath" -ForegroundColor Red
    exit 1
}

$sig = (Get-AuthenticodeSignature $Mongod).Status
Write-Host "mongod signature: $sig"

Write-Host '[5/5] Starting MongoDB service...'
Set-Service MongoDB -StartupType Automatic -ErrorAction SilentlyContinue
Start-Service MongoDB
Start-Sleep -Seconds 3

$s = Get-Service MongoDB
if ($s.Status -eq 'Running') {
    Write-Host 'SUCCESS: MongoDB service is running.' -ForegroundColor Green
    & $Mongod --version
    exit 0
}

Write-Host "Service status: $($s.Status). Testing mongod manually..." -ForegroundColor Yellow
$test = Start-Process -FilePath $Mongod -ArgumentList '--version' -Wait -PassThru -NoNewWindow
if ($test.ExitCode -ne 0) {
    Write-Host "mongod still crashes (exit $($test.ExitCode)). Check: $LogPath and C:\Program Files\MongoDB\Server\8.3\log\mongod.log" -ForegroundColor Red
    exit 1
}

Write-Host 'mongod works but service failed. Try: sc config MongoDB obj= LocalSystem' -ForegroundColor Yellow
exit 1
