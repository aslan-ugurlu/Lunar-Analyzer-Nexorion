<#
.SYNOPSIS
  Builds the frontend for the IIS site and copies it to the site folder (no admin rights needed
  after setup-iis-admin.ps1 has granted the folder to this user).

  VITE_API_BASE_URL=/api: the page calls its own origin and IIS proxies /api/* to the backend,
  so no CORS setting is needed. frontend/public/web.config is copied into dist/ by Vite.
#>
param([string]$SitePath = 'C:\inetpub\lunar-analyzer')

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$frontend = Join-Path $root 'frontend'
$dist = Join-Path $frontend 'dist'

Push-Location $frontend
try {
  $env:VITE_API_BASE_URL = '/api'
  npm run build
  if ($LASTEXITCODE -ne 0) { throw "npm run build failed (exit code $LASTEXITCODE)" }
} finally {
  Remove-Item Env:VITE_API_BASE_URL -ErrorAction SilentlyContinue
  Pop-Location
}
foreach ($file in 'index.html', 'web.config') {
  if (-not (Test-Path (Join-Path $dist $file))) { throw "dist\$file is missing; not publishing." }
}

robocopy $dist $SitePath /MIR /R:2 /W:2 /NFL /NDL /NP /NJH
if ($LASTEXITCODE -ge 8) { throw "robocopy failed (exit code $LASTEXITCODE)" }
$global:LASTEXITCODE = 0
Write-Host "Published $dist -> $SitePath" -ForegroundColor Green
