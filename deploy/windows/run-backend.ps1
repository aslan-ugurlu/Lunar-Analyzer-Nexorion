<#
.SYNOPSIS
  Keeps the FastAPI backend running on 127.0.0.1:8000 for the IIS site; restarts it if it exits.
  Started at logon by the scheduled task "LunarAnalyzerBackend" (deploy/windows/setup-iis-admin.ps1).
  Logs: logs/backend-service.log and logs/uvicorn-prod-<time>.{out,err}.log (not committed).

  The backend binds to 127.0.0.1 only. IIS (ARR) is the only client and adds X-Forwarded-For, so
  --proxy-headers with 127.0.0.1 trusted lets the per-client rate limit see the visitor's address.
#>
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$logs = Join-Path $root 'logs'
New-Item -ItemType Directory -Force -Path $logs | Out-Null
$serviceLog = Join-Path $logs 'backend-service.log'
function Log([string]$Message) { Add-Content -Path $serviceLog -Value ('{0} {1}' -f (Get-Date -Format o), $Message) }

$python = Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps\python3.11.exe'
if (-not (Test-Path $python)) { $python = (Get-Command python -ErrorAction Stop).Source }
$uvicornArgs = @('-m', 'uvicorn', 'backend.main:app', '--host', '127.0.0.1', '--port', '8000',
  '--proxy-headers', '--forwarded-allow-ips', '127.0.0.1')

while ($true) {
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  Log "starting uvicorn with $python"
  $proc = Start-Process -FilePath $python -ArgumentList $uvicornArgs -WorkingDirectory $root -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $logs "uvicorn-prod-$stamp.out.log") `
    -RedirectStandardError (Join-Path $logs "uvicorn-prod-$stamp.err.log")
  $proc.WaitForExit()
  Log "uvicorn exited with code $($proc.ExitCode); restarting in 15 s"
  Start-Sleep -Seconds 15
}
