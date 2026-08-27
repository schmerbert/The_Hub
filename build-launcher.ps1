$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$publish = Join-Path $root '.runtime\launcher-build'

dotnet publish (Join-Path $root 'launcher\HubLauncher.csproj') -c Release -o $publish --ignore-failed-sources -p:NuGetAudit=false
if ($LASTEXITCODE -ne 0) { throw "Launcher build failed with exit code $LASTEXITCODE." }
Get-ChildItem -LiteralPath $publish -Filter 'The Hub.*' | Copy-Item -Destination $root -Force
Write-Host "Built: $(Join-Path $root 'The Hub.exe')"
