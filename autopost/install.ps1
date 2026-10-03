# HeartLens Auto-Poster installer (Windows PowerShell).
#   .\install.ps1          install into this directory
#   .\install.ps1 -Link    also expose `heartlens-autopost` globally
param([switch]$Link)
$ErrorActionPreference = 'Stop'

function Say  ($m) { Write-Host "==> $m" -ForegroundColor Cyan }
function Warn ($m) { Write-Host "!   $m" -ForegroundColor Yellow }
function Die  ($m) { Write-Host "x   $m" -ForegroundColor Red; exit 1 }

$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $dir

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Die "Node.js is not installed. Get Node 20 or newer from https://nodejs.org"
}
$major = [int](node -p "process.versions.node.split('.')[0]")
if ($major -lt 20) { Die "Node 20+ is required (found $(node -v))." }
Say "Node $(node -v) - OK"
Say "No dependencies to install (this package ships with zero of them)."

if (-not (Test-Path .env)) {
  Copy-Item .env.example .env
  Say "Created .env from the template."
} else {
  Say ".env already exists - left untouched."
}
New-Item -ItemType Directory -Force -Path data | Out-Null

if ($Link) {
  try { npm link | Out-Null; Say "Linked globally: run ``heartlens-autopost`` from anywhere." }
  catch { Warn "npm link failed. Use .\autopost.cmd instead." }
}

Set-Content -Path autopost.cmd -Encoding ASCII -Value @'
@echo off
node "%~dp0bin\heartlens-autopost.js" %*
'@

Write-Host ""
Say "Installed."
node bin/heartlens-autopost.js doctor

Write-Host @"

Next
  1. Edit .env and fill in the platforms you want. You can also skip this --
     the outbox target writes posts to a file with no credentials at all.
  2. .\autopost.cmd doctor      what is wired up
  3. .\autopost.cmd postnow     a dry run, so nothing is actually sent
  4. Set DRY_RUN=false in .env when the previews look right
  5. .\autopost.cmd serve       dashboard + scheduler, one-click posting

"@
