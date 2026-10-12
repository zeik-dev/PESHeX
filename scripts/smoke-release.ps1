#requires -Version 5.1
<#
.SYNOPSIS
Prueba de humo del zip del release EN WINDOWS: lo extrae en una ruta con espacios y "ñ", comprueba el
contenido y los hashes, la informacion de version del .exe, y ejecuta el driver con el Ruby del propio
zip con un PATH reducido (como en un equipo limpio). Si algo falla, el release no se publica.

.EXAMPLE
pwsh scripts/smoke-release.ps1 -Zip release-out/PESHeX-1.0.0-windows-x64.zip -Version 1.0.0
#>
param(
    [Parameter(Mandatory)][string]$Zip,
    [Parameter(Mandatory)][string]$Version,
    [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path,
    [string]$Save = ''
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if (-not $Save) { $Save = Join-Path $RepoRoot 'test_saves\Partida_2.rxdata' }

function Fail([string]$msg) { Write-Host "::error::$msg"; throw $msg }
function Ok([string]$msg) { Write-Host "  ok  $msg" }

$work = Join-Path ([IO.Path]::GetTempPath()) ("PESHeX prueba ñ " + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $work | Out-Null
Write-Host "Extrayendo en: $work"
Expand-Archive -LiteralPath $Zip -DestinationPath $work -Force
$top = Join-Path $work "PESHeX-$Version-windows-x64"
if (-not (Test-Path $top)) { Fail "el zip no contiene la carpeta PESHeX-$Version-windows-x64" }

# 1. Estructura minima
foreach ($rel in 'PESHeX.exe', 'ruby\bin\ruby.exe', 'rxdata\driver\rxdata_driver.rb', 'rxdata\edit_rxdata.rb',
                 'LEEME.txt', 'LICENSE', 'THIRD-PARTY-NOTICES.txt', 'CONTENIDO.sha256') {
    if (-not (Test-Path -LiteralPath (Join-Path $top $rel))) { Fail "falta $rel en el zip" }
}
Ok 'estructura del zip'

# 2. Hash de cada archivo
$checked = 0
foreach ($line in Get-Content -LiteralPath (Join-Path $top 'CONTENIDO.sha256')) {
    if ($line -match '^([0-9a-f]{64}) \*(.+)$') {
        $file = Join-Path $top ($Matches[2] -replace '/', '\')
        $hash = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLower()
        if ($hash -ne $Matches[1]) { Fail "hash distinto en $($Matches[2])" }
        $checked++
    }
}
Ok "$checked archivos con el hash correcto"

# 3. Informacion de version del ejecutable (lo que ven el Explorador y los antivirus)
$exe = Join-Path $top 'PESHeX.exe'
$vi = (Get-Item -LiteralPath $exe).VersionInfo
Write-Host ("  VersionInfo: ProductName='{0}' FileDescription='{1}' CompanyName='{2}' FileVersion='{3}' ProductVersion='{4}' Copyright='{5}'" -f `
    $vi.ProductName, $vi.FileDescription, $vi.CompanyName, $vi.FileVersion, $vi.ProductVersion, $vi.LegalCopyright)
if ($vi.ProductName -ne 'PESHeX') { Fail "ProductName es '$($vi.ProductName)', se esperaba 'PESHeX'" }
if (-not ($vi.ProductVersion -like "$Version*" -or $vi.FileVersion -like "$Version*")) { Fail "la version del .exe no empieza por $Version" }
if (-not $vi.CompanyName) { Write-Host '::warning::el .exe no tiene CompanyName (bundle.publisher)' }
Ok 'informacion de version del .exe'

# 4. Ruby del zip con un entorno minimo (PATH solo con System32/Windows, sin variables de Ruby)
$env:PATH = "$env:SystemRoot\System32;$env:SystemRoot"
foreach ($v in 'RUBYOPT', 'RUBYLIB', 'GEM_HOME', 'GEM_PATH', 'RUBY_ROOT') { Remove-Item "Env:\$v" -ErrorAction SilentlyContinue }
$ruby = Join-Path $top 'ruby\bin\ruby.exe'
& $ruby -v
if ($LASTEXITCODE -ne 0) { Fail 'ruby.exe del zip no arranca' }

# Partida en una ruta con espacios y ñ (como la de muchos usuarios)
$dataDir = Join-Path $work 'datos de prueba ñ'
New-Item -ItemType Directory -Path $dataDir | Out-Null
$saveCopy = Join-Path $dataDir 'Partida ñ.rxdata'
Copy-Item -LiteralPath $Save -Destination $saveCopy

$driver = Join-Path $top 'rxdata\driver\rxdata_driver.rb'
& $ruby (Join-Path $RepoRoot 'scripts\smoke_driver.rb') --driver $driver --save $saveCopy --expect-name Furikita
if ($LASTEXITCODE -ne 0) { Fail 'el driver no pasa la prueba de humo con el Ruby del zip' }
Ok 'driver con el Ruby del zip'

# 5. Arranque del .exe (informativo: el runner puede no tener escritorio interactivo)
$p = Start-Process -FilePath $exe -WorkingDirectory $top -PassThru
Start-Sleep -Seconds 6
if ($p.HasExited) {
    Write-Host "::warning::PESHeX.exe termino antes de 6 s (codigo $($p.ExitCode)); en un runner sin escritorio puede ser normal"
} else {
    Ok 'PESHeX.exe arranca y sigue abierto a los 6 s'
    Stop-Process -Id $p.Id -Force
}
Get-Process -Name ruby -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$top*" } | Stop-Process -Force -ErrorAction SilentlyContinue

Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
Write-Host 'SMOKE DEL RELEASE OK'
