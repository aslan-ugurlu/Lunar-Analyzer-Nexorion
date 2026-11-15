#Requires -RunAsAdministrator
<#
.SYNOPSIS
  One-time setup, run as Administrator, to serve Lunar Analyzer from this Windows PC with IIS.

.DESCRIPTION
  1. Enables the IIS features needed for a static site.
  2. Installs IIS URL Rewrite 2.1 and Application Request Routing 3.0 from download.microsoft.com
     (the installer's Authenticode signature must be a valid Microsoft signature).
  3. Enables the ARR server proxy (no port in X-Forwarded-For, 2 min timeout).
  4. Creates the IIS site "LunarAnalyzer" bound ONLY to 127.0.0.1:80 (not reachable from the LAN or
     the internet directly; Cloudflare Tunnel connects to it locally) and stops "Default Web Site".
  5. Registers the logon task "LunarAnalyzerBackend" that keeps the FastAPI backend running on
     127.0.0.1:8000 (deploy/windows/run-backend.ps1). The task is registered, not started.
  6. Installs cloudflared with winget. The tunnel itself is created in the Cloudflare dashboard.

  Safe to run again: existing pieces are detected and left in place.
#>
param(
  [string]$SiteName = 'LunarAnalyzer',
  [string]$SitePath = 'C:\inetpub\lunar-analyzer',
  [string]$TaskName = 'LunarAnalyzerBackend',
  # Windows account that publishes the site and runs the backend (default: the account that started this window).
  [string]$AppUser = "$env:USERDOMAIN\$env:USERNAME"
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

function Step($m) { Write-Host "`n== $m" -ForegroundColor Cyan }
function Ok($m) { Write-Host "   OK  $m" -ForegroundColor Green }
function Warn($m) { Write-Host "   !!  $m" -ForegroundColor Yellow }

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Write-Host "Repository: $repoRoot"
Write-Host "Site user : $AppUser"

# ---------------------------------------------------------------- 1. IIS
Step '1/6 IIS features'
$features = @('IIS-WebServerRole', 'IIS-WebServer', 'IIS-CommonHttpFeatures', 'IIS-StaticContent',
  'IIS-DefaultDocument', 'IIS-HttpErrors', 'IIS-HealthAndDiagnostics', 'IIS-HttpLogging', 'IIS-Security',
  'IIS-RequestFiltering', 'IIS-Performance', 'IIS-HttpCompressionStatic', 'IIS-WebServerManagementTools',
  'IIS-ManagementConsole')
$result = Enable-WindowsOptionalFeature -Online -All -NoRestart -FeatureName $features
if ($result.RestartNeeded) { Warn 'Windows reports that a restart is needed. Let the script finish, then restart.' }
Start-Service W3SVC
Ok 'IIS enabled and W3SVC running'

# ---------------------------------------------------------------- 2. URL Rewrite + ARR
Step '2/6 IIS URL Rewrite 2.1 and Application Request Routing 3.0'
function Install-MicrosoftMsi([string]$Name, [string]$Url, [string]$RegistryKey) {
  if (Test-Path $RegistryKey) { Ok "$Name already installed"; return }
  $msi = Join-Path $env:TEMP ([IO.Path]::GetFileName($Url))
  Invoke-WebRequest -Uri $Url -OutFile $msi -UseBasicParsing
  $sig = Get-AuthenticodeSignature -FilePath $msi
  if ($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') {
    throw "$Name installer is not validly signed by Microsoft (status: $($sig.Status)); not installing."
  }
  $p = Start-Process -FilePath msiexec.exe -ArgumentList @('/i', "`"$msi`"", '/qn', '/norestart') -Wait -PassThru
  if ($p.ExitCode -notin 0, 3010) { throw "$Name install failed (msiexec exit code $($p.ExitCode))" }
  Ok "$Name installed (signature: $($sig.SignerCertificate.Subject.Split(',')[0]))"
}
Install-MicrosoftMsi 'URL Rewrite 2.1' 'https://download.microsoft.com/download/1/2/8/128E2E22-C1B9-44A4-BE2A-5859ED1D4592/rewrite_amd64_en-US.msi' 'HKLM:\SOFTWARE\Microsoft\IIS Extensions\URL Rewrite'
Install-MicrosoftMsi 'Application Request Routing 3.0' 'https://download.microsoft.com/download/E/9/8/E9849D6A-020E-47E4-9FD0-A023E99B54EB/requestRouter_amd64.msi' 'HKLM:\SOFTWARE\Microsoft\IIS Extensions\Application Request Routing'

# ---------------------------------------------------------------- 3. ARR proxy
Step '3/6 ARR server proxy'
$appcmd = Join-Path $env:windir 'system32\inetsrv\appcmd.exe'
function Invoke-AppCmd {
  $out = & $appcmd @args 2>&1
  if ($LASTEXITCODE -ne 0) { throw "appcmd $($args -join ' ') failed: $out" }
  $out
}
Invoke-AppCmd set config -section:system.webServer/proxy /enabled:True /commit:apphost | Out-Null
Ok 'proxy enabled'
foreach ($setting in '/includePortInXForwardedFor:False', '/timeout:00:02:00') {
  $null = & $appcmd set config -section:system.webServer/proxy $setting /commit:apphost 2>&1
  if ($LASTEXITCODE -eq 0) { Ok "proxy $setting" } else { Warn "could not set proxy $setting (continuing)" }
}

# ---------------------------------------------------------------- 4. Site
Step "4/6 IIS site '$SiteName' on 127.0.0.1:80 -> $SitePath"
New-Item -ItemType Directory -Force -Path $SitePath | Out-Null
if (-not (Test-Path (Join-Path $SitePath 'index.html'))) {
  Set-Content -Path (Join-Path $SitePath 'index.html') -Encoding ASCII `
    -Value '<!doctype html><meta charset="utf-8"><title>Lunar Analyzer</title><p>IIS is ready. The app has not been published yet.</p>'
}
# Read for IIS (IIS_IUSRS, IUSR by SID so localized Windows works), modify for the publishing user.
& icacls.exe $SitePath /grant '*S-1-5-32-568:(OI)(CI)RX' '*S-1-5-17:(OI)(CI)RX' "${AppUser}:(OI)(CI)M" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "icacls failed ($LASTEXITCODE)" }
Ok 'folder permissions set'

if (-not ((& $appcmd list apppool "/name:$SiteName" 2>&1) -match 'APPPOOL ')) {
  Invoke-AppCmd add apppool "/name:$SiteName" '/managedRuntimeVersion:' '/managedPipelineMode:Integrated' | Out-Null
}
Ok "application pool '$SiteName' (no managed code)"
if (-not ((& $appcmd list site "/name:$SiteName" 2>&1) -match 'SITE ')) {
  Invoke-AppCmd add site "/name:$SiteName" "/physicalPath:$SitePath" '/bindings:http/127.0.0.1:80:' | Out-Null
}
Invoke-AppCmd set app "$SiteName/" "/applicationPool:$SiteName" | Out-Null
if ((& $appcmd list site '/name:Default Web Site' 2>&1) -match 'SITE ') {
  $null = & $appcmd stop site '/site.name:Default Web Site' 2>&1
  $null = & $appcmd set site '/site.name:Default Web Site' '/serverAutoStart:false' 2>&1
  Ok "'Default Web Site' stopped and disabled"
}
$null = & $appcmd start site "/site.name:$SiteName" 2>&1
Ok "site '$SiteName' bound to http://127.0.0.1:80 only"
# The site is local-only; keep IIS's own inbound HTTP firewall rule off.
Disable-NetFirewallRule -Name 'IIS-WebServerRole-HTTP-In-TCP' -ErrorAction SilentlyContinue
try {
  $r = Invoke-WebRequest -Uri 'http://127.0.0.1/' -UseBasicParsing -TimeoutSec 15
  Ok "local check http://127.0.0.1/ -> HTTP $($r.StatusCode)"
} catch { Warn "local check failed: $($_.Exception.Message)" }

# ---------------------------------------------------------------- 5. Backend logon task
Step "5/6 logon task '$TaskName' (FastAPI backend on 127.0.0.1:8000)"
$runner = Join-Path $PSScriptRoot 'run-backend.ps1'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -WorkingDirectory $repoRoot `
  -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$runner`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $AppUser
$principal = New-ScheduledTaskPrincipal -UserId $AppUser -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings `
  -Description 'Lunar Analyzer: keeps the FastAPI backend running on 127.0.0.1:8000 for the IIS site.' -Force | Out-Null
Ok "task registered (starts at logon of $AppUser; not started now)"

# ---------------------------------------------------------------- 6. cloudflared
Step '6/6 cloudflared (Cloudflare Tunnel connector)'
$cf = @("$env:ProgramFiles\cloudflared\cloudflared.exe", "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe") |
  Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $cf) {
  winget install --id Cloudflare.cloudflared --exact --silent --accept-package-agreements --accept-source-agreements
  $cf = @("$env:ProgramFiles\cloudflared\cloudflared.exe", "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe") |
    Where-Object { Test-Path $_ } | Select-Object -First 1
}
if ($cf) { Ok "cloudflared: $cf ($(& $cf --version 2>&1 | Select-Object -First 1))" }
else { Warn 'cloudflared not found after winget; install it from https://github.com/cloudflare/cloudflared/releases' }

Write-Host "`nDone. Next: publish the frontend (deploy\windows\publish-frontend.ps1, no admin needed)," -ForegroundColor Cyan
Write-Host 'start the backend task, then create the Cloudflare Tunnel (see README).' -ForegroundColor Cyan
