#requires -Version 5.1
<#
.SYNOPSIS
Firma un ejecutable con Authenticode SI hay certificado configurado; si no, no hace nada.

.DESCRIPTION
Pensado para el workflow de release: los secretos WINDOWS_CERT_PFX_B64 (el .pfx en base64) y
WINDOWS_CERT_PASSWORD llegan como variables de entorno. Sin ellos el release sale SIN firmar (y
Windows SmartScreen puede avisar la primera vez; ver LEEME.txt). Una firma de codigo hace que el
aviso desaparezca con el tiempo y muestra el nombre del editor, pero es de pago y no la inventa este script.
#>
param([Parameter(Mandatory)][string]$File)
$ErrorActionPreference = 'Stop'

if (-not $env:WINDOWS_CERT_PFX_B64 -or -not $env:WINDOWS_CERT_PASSWORD) {
    Write-Host 'Sin certificado de firma configurado: el ejecutable se publica sin firmar.'
    exit 0
}

$signtool = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin" -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match '\\x64\\' } | Sort-Object FullName -Descending | Select-Object -First 1
if (-not $signtool) { throw 'No se encontro signtool.exe (Windows SDK).' }

$pfx = Join-Path ([IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString('N') + '.pfx')
try {
    [IO.File]::WriteAllBytes($pfx, [Convert]::FromBase64String($env:WINDOWS_CERT_PFX_B64))
    & $signtool.FullName sign /f $pfx /p $env:WINDOWS_CERT_PASSWORD /fd SHA256 /td SHA256 /tr 'http://timestamp.digicert.com' /d 'PESHeX' $File
    if ($LASTEXITCODE -ne 0) { throw "signtool sign fallo ($LASTEXITCODE)" }
    & $signtool.FullName verify /pa $File
    if ($LASTEXITCODE -ne 0) { throw "signtool verify fallo ($LASTEXITCODE)" }
    Write-Host "Firmado: $File"
} finally {
    Remove-Item $pfx -Force -ErrorAction SilentlyContinue
}
