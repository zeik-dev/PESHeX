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
foreach ($rel in 'PESHeX.exe', 'PESHeX-Updater.exe', 'ruby\bin\ruby.exe', 'rxdata\driver\rxdata_driver.rb', 'rxdata\edit_rxdata.rb',
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

# 3b. El actualizador que va junto a la app (la app lo copia a %TEMP% y lo ejecuta para actualizarse)
$updater = Join-Path $top 'PESHeX-Updater.exe'
$uv = (& $updater --version) | Out-String
if ($LASTEXITCODE -ne 0) { Fail 'PESHeX-Updater.exe --version fallo' }
if ($uv.Trim() -ne "PESHeX-Updater $Version") { Fail "PESHeX-Updater.exe --version dice '$($uv.Trim())', se esperaba 'PESHeX-Updater $Version'" }
# Una consulta REAL a GitHub (informativa: el runner puede no tener red o GitHub limitar las consultas): comprueba el TLS y el formato.
$check = (& $updater check --current 0.0.1) | Out-String
Write-Host "  update check: $($check.Trim())"
try {
    $status = ($check | ConvertFrom-Json).status
    if ($status -notin 'available', 'upToDate', 'error') { Fail "respuesta inesperada de 'check': $check" }
    if ($status -eq 'error') { Write-Host '::warning::PESHeX-Updater check no pudo consultar GitHub (red o limite de consultas)' }
} catch { Fail "'PESHeX-Updater check' no devolvio un JSON: $check" }
Ok 'actualizador (version y consulta a GitHub)'

# 3c. Actualizacion LOCAL con los binarios reales (sin red): el mismo codigo que instala una actualizacion de verdad.
#     Se «envejece» una copia de la carpeta (con espacios y ñ en la ruta), se arranca SU PESHeX.exe (queda el .exe en uso, como
#     cuando la app esta abierta) y se instala el zip encima: el actualizador debe ESPERAR a que el .exe se cierre, reemplazar
#     todos los archivos (2.600+), retirar lo que la version nueva ya no trae, respetar lo ajeno y no dejar restos.
$zipFull = (Resolve-Path -LiteralPath $Zip).Path
$old = Join-Path $work 'carpeta vieja ñ\PESHeX'
New-Item -ItemType Directory -Path (Split-Path $old) | Out-Null
Copy-Item -LiteralPath $top -Destination $old -Recurse
Set-Content -LiteralPath (Join-Path $old 'LEEME.txt') -Value 'version vieja'
Remove-Item -LiteralPath (Join-Path $old 'THIRD-PARTY-NOTICES.txt')
Set-Content -LiteralPath (Join-Path $old 'archivo-viejo.txt') -Value 'solo en la version vieja'
Set-Content -LiteralPath (Join-Path $old 'usuario.txt') -Value 'mio'
$oldHash = (Get-FileHash -LiteralPath (Join-Path $old 'archivo-viejo.txt') -Algorithm SHA256).Hash.ToLower()
Add-Content -LiteralPath (Join-Path $old 'CONTENIDO.sha256') -Value "$oldHash *archivo-viejo.txt" -Encoding ascii
$updLog = Join-Path $work 'registro del actualizador\updater.log'

$oldApp = Start-Process -FilePath (Join-Path $old 'PESHeX.exe') -WorkingDirectory $old -PassThru
Start-Sleep -Seconds 3
$appWasRunning = -not $oldApp.HasExited
if (-not $appWasRunning) { Write-Host '::warning::PESHeX.exe de la copia vieja no siguio abierto (runner sin escritorio): no se prueba la espera por el .exe en uso' }

$psi = [System.Diagnostics.ProcessStartInfo]::new($updater)
# (Arguments como una sola cadena entre comillas: funciona igual en Windows PowerShell 5.1 y en PowerShell 7; las rutas llevan espacios y ñ)
$psi.Arguments = (@('apply-local', '--zip', $zipFull, '--app-dir', $old, '--no-relaunch', '--wait', '90', '--log', $updLog) | ForEach-Object { '"' + $_ + '"' }) -join ' '
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.UseShellExecute = $false
$upd = [System.Diagnostics.Process]::Start($psi)
$outTask = $upd.StandardOutput.ReadToEndAsync()
$errTask = $upd.StandardError.ReadToEndAsync()
Start-Sleep -Seconds 4
if ($appWasRunning) {
    if ($upd.HasExited) { Fail "el actualizador no espero a que se cerrara PESHeX.exe (termino con codigo $($upd.ExitCode)): $($errTask.Result)" }
    Ok 'el actualizador espera mientras PESHeX.exe sigue abierto'
    Stop-Process -Id $oldApp.Id -Force
}
if (-not $upd.WaitForExit(180000)) { $upd.Kill(); Fail 'el actualizador local no termino en 3 minutos' }
if ($upd.ExitCode -ne 0) { Fail "apply-local fallo (codigo $($upd.ExitCode)): $($errTask.Result) $($outTask.Result)" }
Write-Host "  $($outTask.Result.Trim())"

# Todo coincide con el CONTENIDO.sha256 del zip nuevo
$bad = 0
foreach ($line in Get-Content -LiteralPath (Join-Path $top 'CONTENIDO.sha256')) {
    if ($line -match '^([0-9a-f]{64}) \*(.+)$') {
        $f = Join-Path $old ($Matches[2] -replace '/', '\')
        if (-not (Test-Path -LiteralPath $f) -or (Get-FileHash -LiteralPath $f -Algorithm SHA256).Hash.ToLower() -ne $Matches[1]) { $bad++; Write-Host "  distinto o ausente: $($Matches[2])" }
    }
}
if ($bad -gt 0) { Fail "tras la actualizacion local $bad archivos no coinciden con CONTENIDO.sha256" }
if (Test-Path -LiteralPath (Join-Path $old 'archivo-viejo.txt')) { Fail 'el archivo que la version nueva ya no trae no se retiro' }
if ((Get-Content -LiteralPath (Join-Path $old 'usuario.txt') -Raw).Trim() -ne 'mio') { Fail 'el archivo del usuario se modifico' }
$leftovers = Get-ChildItem -LiteralPath $old -Force | Where-Object { $_.Name -like '.peshex-update*' -or $_.Name -like '.update-backup-*' }
if ($leftovers) { Fail "quedaron restos de la actualizacion: $($leftovers.Name -join ', ')" }
if (-not (Select-String -LiteralPath $updLog -Pattern 'instalacion completada' -Quiet)) { Fail 'el registro del actualizador no dice que se completo' }
Ok 'actualizacion local con los binarios reales (espera, reemplazo, retirada de lo viejo, sin restos)'

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
