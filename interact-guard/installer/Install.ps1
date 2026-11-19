#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Install Interact Guard — registers Add/Remove Programs, Startup, optional Windows Service.
#>
param(
  [string]$HrmBaseUrl = "https://192.168.10.6:8443",
  [string]$InstallDir = "$env:ProgramFiles\InteractGuard"
)

$ErrorActionPreference = "Stop"
$Product = "Interact Guard"
$Publisher = "Interact Global"
$Version = "1.2.63"
$UninstallKey = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\InteractGuard"

$Payload = Split-Path -Parent $MyInvocation.MyCommand.Path
$Payload = Join-Path $Payload "payload"
if (-not (Test-Path (Join-Path $Payload "InteractGuard.exe"))) {
  throw "payload\InteractGuard.exe not found next to Install.ps1"
}

Write-Host "Installing $Product to $InstallDir ..."
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Copy-Item -Path (Join-Path $Payload "*") -Destination $InstallDir -Recurse -Force

# Per-user + machine-wide writable folders (WebView2 must not use Program Files / systemprofile)
$data = Join-Path $env:LOCALAPPDATA "InteractGuard"
New-Item -ItemType Directory -Force -Path $data | Out-Null
$programData = Join-Path $env:ProgramData "InteractGuard"
New-Item -ItemType Directory -Force -Path $programData | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $programData "WebView2") | Out-Null
icacls.exe $programData /grant "*S-1-5-32-545:(OI)(CI)M" /T /C | Out-Null

$settingsPath = Join-Path $data "settings.json"
if (-not (Test-Path $settingsPath)) {
  $seed = @{
    HrmBaseUrl = $HrmBaseUrl
    AdminEnabled = $false
    IdleSecondsBeforeCheck = 120
    AdminExitPassword = "InteractAdmin"
  } | ConvertTo-Json
  Set-Content -Path $settingsPath -Value $seed -Encoding UTF8
  Set-Content -Path (Join-Path $programData "settings.json") -Value $seed -Encoding UTF8
}

# Startup (current user + all users Run key for machine)
$runKey = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run"
New-ItemProperty -Path $runKey -Name "InteractGuard" -Value "`"$InstallDir\InteractGuard.exe`"" -PropertyType String -Force | Out-Null
New-ItemProperty -Path $runKey -Name "InteractGuardWatchdog" -Value "`"$InstallDir\InteractGuard.Watchdog.exe`"" -PropertyType String -Force | Out-Null

# Add/Remove Programs
New-Item -Path $UninstallKey -Force | Out-Null
Set-ItemProperty -Path $UninstallKey -Name "DisplayName" -Value $Product
Set-ItemProperty -Path $UninstallKey -Name "DisplayVersion" -Value $Version
Set-ItemProperty -Path $UninstallKey -Name "Publisher" -Value $Publisher
Set-ItemProperty -Path $UninstallKey -Name "InstallLocation" -Value $InstallDir
Set-ItemProperty -Path $UninstallKey -Name "DisplayIcon" -Value "$InstallDir\InteractGuard.exe"
Set-ItemProperty -Path $UninstallKey -Name "UninstallString" -Value "powershell.exe -ExecutionPolicy Bypass -File `"$InstallDir\Uninstall.ps1`""
Set-ItemProperty -Path $UninstallKey -Name "QuietUninstallString" -Value "powershell.exe -ExecutionPolicy Bypass -File `"$InstallDir\Uninstall.ps1`" -Quiet"
Set-ItemProperty -Path $UninstallKey -Name "NoModify" -Value 1 -Type DWord
Set-ItemProperty -Path $UninstallKey -Name "NoRepair" -Value 1 -Type DWord

Copy-Item (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "Uninstall.ps1") -Destination $InstallDir -Force

# Optional Windows Service
$svcExe = Join-Path $InstallDir "InteractGuard.Service.exe"
if (Test-Path $svcExe) {
  $existing = Get-Service -Name "InteractGuard" -ErrorAction SilentlyContinue
  if ($existing) {
    Stop-Service InteractGuard -Force -ErrorAction SilentlyContinue
    sc.exe delete InteractGuard | Out-Null
    Start-Sleep -Seconds 2
  }
  New-Service -Name "InteractGuard" -BinaryPathName "`"$svcExe`"" -DisplayName $Product -StartupType Automatic | Out-Null
  Start-Service InteractGuard -ErrorAction SilentlyContinue
}

# Show Installed notice on next agent start
$notice = Join-Path $data "installed-notice.shown"
Remove-Item -Force $notice -ErrorAction SilentlyContinue

Start-Process -FilePath (Join-Path $InstallDir "InteractGuard.Watchdog.exe") -WorkingDirectory $InstallDir -ErrorAction SilentlyContinue
Start-Process -FilePath (Join-Path $InstallDir "InteractGuard.exe") -WorkingDirectory $InstallDir -ErrorAction SilentlyContinue

try {
  Add-Type -AssemblyName System.Windows.Forms | Out-Null
  [System.Windows.Forms.MessageBox]::Show(
    "Interact Guard is installed on this PC.`n`nThe agent is running in the system tray.",
    "Installed",
    [System.Windows.Forms.MessageBoxButtons]::OK,
    [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
} catch { }

Write-Host "Done. $Product is in Add or remove programs."
Write-Host "It will appear in HRM Admin after heartbeat. Admin must ON it before monitoring starts."
