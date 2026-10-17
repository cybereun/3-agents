# Creates desktop shortcuts for 3 Agents (start without a console window / stop).
param([string]$Root = (Split-Path -Parent $PSScriptRoot))
$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path -LiteralPath $Root).Path

$desktop = [Environment]::GetFolderPath('Desktop')
$shell = New-Object -ComObject WScript.Shell
$icon = Join-Path $Root 'public\icons\app.ico'

function New-Shortcut([string]$Name, [string]$Target, [string]$Arguments, [string]$Description) {
  $path = Join-Path $desktop "$Name.lnk"
  $lnk = $shell.CreateShortcut($path)
  $lnk.TargetPath = $Target
  $lnk.Arguments = $Arguments
  $lnk.WorkingDirectory = $Root
  $lnk.Description = $Description
  if (Test-Path $icon) { $lnk.IconLocation = "$icon,0" }
  $lnk.Save()
  Write-Output "created: $path"
}

$wscript = Join-Path $env:WINDIR 'System32\wscript.exe'
$cmd = Join-Path $env:WINDIR 'System32\cmd.exe'

New-Shortcut '3 Agents' $wscript ('"' + (Join-Path $Root 'start-hidden.vbs') + '"') 'Start 3 Agents (no console window)'
New-Shortcut '3 Agents Stop' $cmd ('/c ""' + (Join-Path $Root 'stop.bat') + '""') 'Stop the 3 Agents server'
