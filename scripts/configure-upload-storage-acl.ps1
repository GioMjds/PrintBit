#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Configures private upload storage ACLs for Microsoft Defender upload staging and quarantine.

.DESCRIPTION
  Ensures uploads/.staging and uploads/quarantine are restricted exclusively to SYSTEM and
  Administrators, explicitly denying/removing permissions for standard users and the kiosk account.
#>

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$KioskUser
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Write-Host ""
Write-Host "[PrintBit] Configuring upload storage ACLs..." -ForegroundColor Cyan

# Resolve kiosk user to SID
try {
  $ntAccount = New-Object System.Security.Principal.NTAccount($KioskUser)
  $kioskSidObj = $ntAccount.Translate([System.Security.Principal.SecurityIdentifier])
  $kioskSid = $kioskSidObj.Value
  Write-Host "[PrintBit] Resolved kiosk user '$KioskUser' to SID: $kioskSid" -ForegroundColor Gray
} catch {
  Write-Host "[PrintBit] [ERROR] Failed to resolve kiosk user '$KioskUser' to a SecurityIdentifier: $_" -ForegroundColor Red
  exit 1
}

$directories = @(
  (Join-Path $PSScriptRoot '..\uploads\.staging'),
  (Join-Path $PSScriptRoot '..\uploads\quarantine')
)

foreach ($dir in $directories) {
  $resolvedPath = [System.IO.Path]::GetFullPath($dir)
  if (-not (Test-Path $resolvedPath)) {
    New-Item -ItemType Directory -Path $resolvedPath -Force | Out-Null
  }

  Write-Host "[PrintBit] Securing directory: $resolvedPath" -ForegroundColor Yellow

  # 1. Break inheritance and remove inherited access rules
  $icaclsInheritance = & icacls.exe "$resolvedPath" /inheritance:r 2>&1
  if ($LASTEXITCODE -ne 0) {
    Write-Host "[PrintBit] [ERROR] Failed to reset inheritance on $resolvedPath : $icaclsInheritance" -ForegroundColor Red
    exit 1
  }

  # 2. Grant Full Control only to SYSTEM and BUILTIN\Administrators with object/container inheritance
  $icaclsGrant = & icacls.exe "$resolvedPath" /grant:r "SYSTEM:(OI)(CI)(F)" "BUILTIN\Administrators:(OI)(CI)(F)" 2>&1
  if ($LASTEXITCODE -ne 0) {
    Write-Host "[PrintBit] [ERROR] Failed to grant SYSTEM and Administrators access on $resolvedPath : $icaclsGrant" -ForegroundColor Red
    exit 1
  }

  # 3. Explicitly remove any remaining grants for Users, Authenticated Users, and the kiosk account
  & icacls.exe "$resolvedPath" /remove:g "$KioskUser" "*$kioskSid" "BUILTIN\Users" "Users" "Authenticated Users" 2>&1 | Out-Null
}

Write-Host "[PrintBit] [OK] Upload staging and quarantine storage secured successfully." -ForegroundColor Green
exit 0
