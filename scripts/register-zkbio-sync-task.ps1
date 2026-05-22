# Registers Windows Task Scheduler job for ZKBio -> MySQL sync.
# DEFAULT: runs every 30 minutes, all day (repeating).
#
# Run ONCE as Administrator:
#   cd "C:\Users\Waqas Rafique\interact-hrm2\scripts"
#   powershell -ExecutionPolicy Bypass -File .\register-zkbio-sync-task.ps1
#
# Once per day only (specific clock time):
#   .\register-zkbio-sync-task.ps1 -Daily -DailyTime "00:30"

param(
    [string] $TaskName = "ZKBioPunchSync",
    [int] $IntervalMinutes = 30,
    [switch] $Daily,
    [string] $DailyTime = "00:30"
)

$ErrorActionPreference = "Stop"

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "Run this script as Administrator (Task Scheduler needs it)." -ForegroundColor Red
    exit 1
}

if ($IntervalMinutes -lt 1 -or $IntervalMinutes -gt 1440) {
    Write-Host "IntervalMinutes must be between 1 and 1440." -ForegroundColor Red
    exit 1
}

$runner = Join-Path $PSScriptRoot "run-zkbio-sync.ps1"
if (-not (Test-Path -LiteralPath $runner)) {
    Write-Host "Missing: $runner" -ForegroundColor Red
    exit 1
}

$psExe = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$argLine = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$runner`""
$action = New-ScheduledTaskAction -Execute $psExe -Argument $argLine

if ($Daily) {
    $parts = $DailyTime -split ":"
    $h = [int]$parts[0]
    $m = if ($parts.Count -gt 1) { [int]$parts[1] } else { 0 }
    $todayMidnight = (Get-Date).Date
    $at = $todayMidnight.AddHours($h).AddMinutes($m)
    $trigger = New-ScheduledTaskTrigger -Daily -At $at
    Write-Host "Trigger: once daily at $($at.ToString('HH:mm')) local time."
}
else {
    $startTime = (Get-Date).AddMinutes(1)
    $trigger = New-ScheduledTaskTrigger -Once -At $startTime `
        -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes) `
        -RepetitionDuration (New-TimeSpan -Days 36525)
    Write-Host "Trigger: every $IntervalMinutes minutes (first run ~1 min from now, then repeating)."
}

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Hours 2)

$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Write-Host "OK: Scheduled task '$TaskName' registered." -ForegroundColor Green
Write-Host "Check: Task Scheduler (taskschd.msc) -> Task Scheduler Library -> $TaskName"
