#Requires -RunAsAdministrator
param([switch]$Quiet)

$ErrorActionPreference = "SilentlyContinue"
$InstallDir = "$env:ProgramFiles\InteractGuard"
$UninstallKey = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\InteractGuard"
$runKey = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run"

Stop-Service InteractGuard -Force -ErrorAction SilentlyContinue
sc.exe delete InteractGuard | Out-Null

Get-Process InteractGuard, "InteractGuard.Watchdog", "InteractGuard.Service" -ErrorAction SilentlyContinue |
  Stop-Process -Force -ErrorAction SilentlyContinue

Remove-ItemProperty -Path $runKey -Name "InteractGuard" -ErrorAction SilentlyContinue
Remove-ItemProperty -Path $runKey -Name "InteractGuardWatchdog" -ErrorAction SilentlyContinue
Remove-Item -Path $UninstallKey -Recurse -Force -ErrorAction SilentlyContinue

Start-Sleep -Seconds 1
if (Test-Path $InstallDir) {
  Remove-Item -Path $InstallDir -Recurse -Force -ErrorAction SilentlyContinue
}

# Optional: wipe local settings (full remove)
$data = Join-Path $env:LOCALAPPDATA "InteractGuard"
if (Test-Path $data) {
  Remove-Item -Path $data -Recurse -Force -ErrorAction SilentlyContinue
}

if (-not $Quiet) {
  Write-Host "Interact Guard completely removed."
}
