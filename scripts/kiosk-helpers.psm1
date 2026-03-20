Set-StrictMode -Version Latest

function Ensure-RegistryKey {
  [CmdletBinding()]
  param([Parameter(Mandatory = $true)][string]$Path)

  if (-not (Test-Path $Path)) {
    New-Item -Path $Path -Force | Out-Null
  }
}

function Set-DwordValue {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][int]$Value
  )

  Ensure-RegistryKey -Path $Path
  New-ItemProperty -Path $Path -Name $Name -Value $Value -PropertyType DWord -Force | Out-Null
}

function Remove-RegistryValueIfExists {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Name
  )

  if (-not (Test-Path $Path)) { return }
  $item = Get-ItemProperty -Path $Path -ErrorAction SilentlyContinue
  if ($null -eq $item) { return }
  if ($item.PSObject.Properties.Name -contains $Name) {
    Remove-ItemProperty -Path $Path -Name $Name -Force -ErrorAction SilentlyContinue
  }
}

function Get-DwordValueOrNull {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Name
  )

  if (-not (Test-Path $Path)) { return $null }
  $item = Get-ItemProperty -Path $Path -ErrorAction SilentlyContinue
  if ($null -eq $item) { return $null }
  if ($item.PSObject.Properties.Name -contains $Name) {
    return [int]$item.$Name
  }
  return $null
}

function Get-DwordOrNull {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Name
  )

  return Get-DwordValueOrNull -Path $Path -Name $Name
}

function Get-StateKeySuffix {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Name
  )

  return (($Path + '__' + $Name) -replace '[^A-Za-z0-9_]', '_')
}

Export-ModuleMember -Function Ensure-RegistryKey, Set-DwordValue, Remove-RegistryValueIfExists, Get-DwordValueOrNull, Get-DwordOrNull, Get-StateKeySuffix
