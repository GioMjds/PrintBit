Set-StrictMode -Version Latest

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

Export-ModuleMember -Function Get-DwordValueOrNull
