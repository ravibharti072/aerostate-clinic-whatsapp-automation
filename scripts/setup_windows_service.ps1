<#
.SYNOPSIS
    Automates registering Aerostate Clinic Backend as a resilient Windows Service.
.DESCRIPTION
    Uses NSSM (Non-Sucking Service Manager) or sc.exe to register the backend
    and Caddy web server to run automatically on Windows startup.
#>

param(
    [string]$ServiceName = "AerostateClinicBackend",
    [string]$DisplayName = "Aerostate Clinic Automation Service",
    [int]$Port = 8000
)

$AppDir = (Resolve-Path "$PSScriptRoot\..").Path
$PythonPath = (Get-Command python).Source
$LogDir = Join-Path $AppDir "logs"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

Write-Host "========================================================" -ForegroundColor Cyan
Write-Host " Aerostate Clinic - Windows Service Setup" -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "App Root:    $AppDir"
Write-Host "Python Exec: $PythonPath"
Write-Host "Logs Path:   $LogDir"
Write-Host ""

# Check if running with Administrator privileges
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Warning "This script should be run in an elevated PowerShell prompt (Run as Administrator) to create a Windows Service."
    Write-Host ""
}

# Recommend NSSM command
Write-Host "To install as a permanent self-healing Windows Service with NSSM:" -ForegroundColor Green
Write-Host "1. Download NSSM from https://nssm.cc/download and place in PATH."
Write-Host "2. Run the following commands as Administrator:"
Write-Host ""
Write-Host "   nssm install $ServiceName `"$PythonPath`" `"-m uvicorn main:app --host 127.0.0.1 --port $Port --workers 2`"" -ForegroundColor Yellow
Write-Host "   nssm set $ServiceName AppDirectory `"$AppDir`"" -ForegroundColor Yellow
Write-Host "   nssm set $ServiceName AppStdout `"$LogDir\service_out.log`"" -ForegroundColor Yellow
Write-Host "   nssm set $ServiceName AppStderr `"$LogDir\service_err.log`"" -ForegroundColor Yellow
Write-Host "   nssm set $ServiceName Start SERVICE_AUTO_START" -ForegroundColor Yellow
Write-Host "   nssm start $ServiceName" -ForegroundColor Yellow
Write-Host ""
Write-Host "To run Caddy with automatic SSL:" -ForegroundColor Green
Write-Host "   caddy start --config `"$AppDir\Caddyfile`"" -ForegroundColor Yellow
Write-Host ""
Write-Host "========================================================" -ForegroundColor Cyan
