# Run as Administrator - installs MongoDB 7.0.22 (stable on older Windows/CPU)
$ErrorActionPreference = 'Stop'
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host 'Run as Administrator.' -ForegroundColor Red; exit 1
}

$MsiUrl = 'https://fastdl.mongodb.org/windows/mongodb-windows-x86_64-7.0.22-signed.msi'
$MsiPath = Join-Path $env:TEMP 'mongodb-windows-x86_64-7.0.22-signed.msi'
$LogPath = Join-Path $env:TEMP 'mongodb-7-install.log'
$Product83 = '{224A0A82-7E6C-47D3-B6D3-BAD474082D49}'

Write-Host '=== MongoDB 7.0.22 Install (replaces broken 8.3) ===' -ForegroundColor Cyan

Stop-Service MongoDB -Force -ErrorAction SilentlyContinue

# Remove MongoDB 8.3 if present
$old = Get-ItemProperty HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\* -EA SilentlyContinue |
    Where-Object { $_.DisplayName -like 'MongoDB 8.3*' }
if ($old) {
    Write-Host 'Removing MongoDB 8.3...'
    Start-Process msiexec.exe -ArgumentList '/x', $Product83, '/qn', '/norestart' -Wait
    Start-Sleep -Seconds 5
}

Write-Host 'Downloading MongoDB 7.0.22 MSI...'
if (-not (Test-Path $MsiPath) -or (Get-Item $MsiPath).Length -lt 200MB) {
    Invoke-WebRequest -Uri $MsiUrl -OutFile $MsiPath -UseBasicParsing
}

Write-Host 'Installing mongod + service...'
$args = @(
    '/i', "`"$MsiPath`"",
    '/qn', '/norestart',
    'ADDLOCAL=ServerService,Router,MiscellaneousTools',
    'MONGO_SERVICE_INSTALL=1',
    'SHOULD_INSTALL_COMPASS=0',
    "/l*v", "`"$LogPath`""
)
$p = Start-Process msiexec.exe -ArgumentList $args -Wait -PassThru
if ($p.ExitCode -ne 0 -and $p.ExitCode -ne 3010) { Write-Host "MSI exit $($p.ExitCode). Log: $LogPath" -ForegroundColor Red; exit $p.ExitCode }

$mongod = 'C:\Program Files\MongoDB\Server\7.0\bin\mongod.exe'
if (-not (Test-Path $mongod)) {
    Write-Host "mongod not found at $mongod. Log: $LogPath" -ForegroundColor Red
    exit 1
}

$test = Start-Process -FilePath $mongod -ArgumentList '--version' -Wait -PassThru -NoNewWindow
if ($test.ExitCode -ne 0) {
    Write-Host "mongod still crashes (exit $($test.ExitCode)). Disable antivirus for MongoDB folder and retry." -ForegroundColor Red
    exit 1
}

& $mongod --version
Start-Service MongoDB
Start-Sleep -Seconds 2
$s = Get-Service MongoDB
Write-Host "Service status: $($s.Status)" -ForegroundColor $(if ($s.Status -eq 'Running') { 'Green' } else { 'Yellow' })
if ($s.Status -ne 'Running') { exit 1 }
