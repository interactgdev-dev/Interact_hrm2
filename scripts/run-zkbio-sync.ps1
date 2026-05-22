# ZKBio -> MySQL punch sync (runner). Put secrets in scripts\zkbio-sync.local.env only, not here.

param(
    [string] $Start,
    [string] $End
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$LocalEnv = Join-Path $PSScriptRoot "zkbio-sync.local.env"

function Import-ZkbioLocalEnv {
    param([Parameter(Mandatory)][string] $LiteralPath)
    $lines = Get-Content -LiteralPath $LiteralPath -Encoding utf8 -ErrorAction Stop
    foreach ($line in $lines) {
        $t = $line.Trim()
        if (-not $t -or $t.StartsWith("#")) { continue }
        $eq = $t.IndexOf("=")
        if ($eq -lt 1) { continue }
        $key = $t.Substring(0, $eq).Trim()
        $val = $t.Substring($eq + 1).Trim()
        if ($val.Length -ge 2) {
            if (($val.StartsWith('"') -and $val.EndsWith('"')) -or ($val.StartsWith("'") -and $val.EndsWith("'"))) {
                $val = $val.Substring(1, $val.Length - 2)
            }
        }
        if (-not $key) { continue }
        $existing = [Environment]::GetEnvironmentVariable($key, "Process")
        if ([string]::IsNullOrEmpty($existing)) {
            [Environment]::SetEnvironmentVariable($key, $val, "Process")
        }
    }
}

if (-not (Test-Path -LiteralPath $LocalEnv)) {
    Write-Host "Missing: $LocalEnv" -ForegroundColor Red
    Write-Host "Copy scripts\zkbio-sync.env.example -> scripts\zkbio-sync.local.env and fill ZKBIO_SESSION + DB_*."
    exit 1
}

Import-ZkbioLocalEnv -LiteralPath $LocalEnv

$sess = [Environment]::GetEnvironmentVariable("ZKBIO_SESSION", "Process")
if ([string]::IsNullOrWhiteSpace($sess)) {
    Write-Host "ZKBIO_SESSION is empty. Paste Cookie SESSION value in scripts\zkbio-sync.local.env" -ForegroundColor Red
    exit 1
}

$python = $null
foreach ($c in @(
        (Join-Path $env:LOCALAPPDATA "Programs\Python\Python314\python.exe"),
        (Join-Path $env:LOCALAPPDATA "Programs\Python\Python312\python.exe"),
        (Join-Path $env:LOCALAPPDATA "Programs\Python\Python311\python.exe")
    )) {
    if (Test-Path -LiteralPath $c) {
        $python = $c
        break
    }
}
if (-not $python) {
    if (Get-Command py -ErrorAction SilentlyContinue) { $python = "py" }
    else { $python = (Get-Command python -ErrorAction SilentlyContinue).Source }
}
if (-not $python) {
    Write-Host "Python not found." -ForegroundColor Red
    exit 1
}

Set-Location -LiteralPath $RepoRoot
$script = Join-Path $PSScriptRoot "zkbio_sync_punches.py"
$pyArgs = @($script)
if ($Start) { $pyArgs += "--start", $Start }
if ($End) { $pyArgs += "--end", $End }

if ($python -eq "py") {
    & py -3 @pyArgs
} else {
    & $python @pyArgs
}
exit $LASTEXITCODE