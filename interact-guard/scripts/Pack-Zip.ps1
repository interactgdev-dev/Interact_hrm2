<#
.SYNOPSIS
  Build Release binaries and pack InteractGuard-Installer-vX.Y.Z.zip
  Primary install: double-click Setup.exe (Windows installer wizard).
#>
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

$Version = "1.2.66"
$Out = Join-Path $Root "dist"
$Stage = Join-Path $Out "stage"
$Payload = Join-Path $Stage "payload"

Write-Host "== Building Interact Guard $Version =="
dotnet build .\InteractGuard.sln -c Release
if ($LASTEXITCODE -ne 0) { throw "build failed" }

Remove-Item $Stage -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $Payload | Out-Null

$agentOut = Join-Path $Root "InteractGuard.Agent\bin\Release\net8.0-windows"
$wdOut = Join-Path $Root "InteractGuard.Watchdog\bin\Release\net8.0-windows"
$svcOut = Join-Path $Root "InteractGuard.Service\bin\Release\net8.0-windows"
$setupOut = Join-Path $Root "InteractGuard.Setup\bin\Release\net8.0-windows"

Copy-Item (Join-Path $agentOut "*") $Payload -Recurse -Force
$ico = Join-Path $Root "assets\InteractGuard.ico"
if (Test-Path $ico) { Copy-Item $ico $Payload -Force }
Copy-Item (Join-Path $wdOut "InteractGuard.Watchdog.exe") $Payload -Force
Copy-Item (Join-Path $wdOut "InteractGuard.Watchdog.dll") $Payload -Force -ErrorAction SilentlyContinue
Copy-Item (Join-Path $wdOut "InteractGuard.Watchdog.deps.json") $Payload -Force -ErrorAction SilentlyContinue
Copy-Item (Join-Path $wdOut "InteractGuard.Watchdog.runtimeconfig.json") $Payload -Force -ErrorAction SilentlyContinue
if (Test-Path (Join-Path $svcOut "InteractGuard.Service.exe")) {
  Copy-Item (Join-Path $svcOut "*") $Payload -Recurse -Force
}

# Windows Setup.exe at zip root — this is what users double-click
Copy-Item (Join-Path $setupOut "Setup.exe") $Stage -Force
Copy-Item (Join-Path $setupOut "Setup.dll") $Stage -Force -ErrorAction SilentlyContinue
Copy-Item (Join-Path $setupOut "Setup.deps.json") $Stage -Force -ErrorAction SilentlyContinue
Copy-Item (Join-Path $setupOut "Setup.runtimeconfig.json") $Stage -Force -ErrorAction SilentlyContinue
# .NET needs runtimeconfig next to Setup; also copy any native deps if present
Get-ChildItem $setupOut -File | Where-Object { $_.Extension -in ".json",".dll" } | ForEach-Object {
  Copy-Item $_.FullName $Stage -Force
}

$zip = Join-Path $Out "InteractGuard-Installer-v$Version.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }

# PowerShell Compress-Archive with "$stage\*" often drops root files — pack explicitly.
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
if (Test-Path $zip) { Remove-Item $zip -Force }
$zipStream = [System.IO.File]::Open($zip, [System.IO.FileMode]::Create)
try {
  $archive = New-Object System.IO.Compression.ZipArchive($zipStream, [System.IO.Compression.ZipArchiveMode]::Create)
  try {
    Get-ChildItem -Path $Stage -Recurse -File | ForEach-Object {
      $rel = $_.FullName.Substring($Stage.Length).TrimStart('\', '/')
      [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
        $archive, $_.FullName, $rel.Replace('\', '/'),
        [System.IO.Compression.CompressionLevel]::Optimal)
    }
  } finally { $archive.Dispose() }
} finally { $zipStream.Dispose() }

Write-Host ""
Write-Host "Created: $zip"
Write-Host "Install: unzip → double-click Setup.exe (UAC prompt) → Install"
Write-Host "Uninstall: Add or remove programs → Interact Guard"
