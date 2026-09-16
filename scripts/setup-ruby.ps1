#requires -Version 5.1
<#
.SYNOPSIS
Descarga y extrae el Ruby portatil (RubyInstaller2, sin DevKit) hacia
src-tauri/resources/ruby/, para que Tauri lo empaquete como recurso.

.DESCRIPTION
Corre esto una vez despues de clonar el repo, antes del primer
`cargo tauri dev` o `cargo tauri build`. Es idempotente: si la version
pedida ya esta instalada, no vuelve a descargar nada.

edit_rxdata.rb y el driver son puro stdlib de Ruby (optparse, zlib,
fileutils, ripper opcional) - no necesitan gems ni DevKit, asi que el 7z
"sin DevKit" alcanza y el binario resultante queda mas liviano.

Requiere 7-Zip (7z.exe) instalado en ESTA maquina de desarrollo/build.
El usuario final de la app no necesita nada de esto: lo que se empaqueta
es el Ruby ya extraido.
#>

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# Version fijada a proposito (no "latest") para que la build sea
# reproducible. El checksum se verifico a mano contra la descarga real de
# este release antes de pegarlo aca - si se sube de version, hay que volver
# a verificarlo de la misma forma, nunca copiarlo de una pagina sin chequear.
$RubyVersion = '4.0.7-1'
$ArchiveName = "rubyinstaller-$RubyVersion-x64.7z"
$DownloadUrl = "https://github.com/oneclick/rubyinstaller2/releases/download/RubyInstaller-$RubyVersion/$ArchiveName"
$ExpectedSha256 = '7A9BE96D3448ECBD9A81ECCAE1F619131DFCC761F2C98DDED03ECE6C05D0474F'

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$ResourcesDir = Join-Path $RepoRoot 'src-tauri\resources\ruby'
$VersionMarker = Join-Path $ResourcesDir '.ruby-version-installed'

if ((Test-Path $VersionMarker) -and ((Get-Content $VersionMarker -Raw).Trim() -eq $RubyVersion)) {
    Write-Host "Ruby portatil $RubyVersion ya esta instalado en $ResourcesDir - nada que hacer."
    exit 0
}

$SevenZipPath = $null
$SevenZipCmd = Get-Command '7z.exe' -ErrorAction SilentlyContinue
if ($SevenZipCmd) {
    $SevenZipPath = $SevenZipCmd.Source
}
elseif (Test-Path 'C:\Program Files\7-Zip\7z.exe') {
    $SevenZipPath = 'C:\Program Files\7-Zip\7z.exe'
}
if (-not $SevenZipPath) {
    Write-Error "No se encontro 7z.exe. Instala 7-Zip (https://www.7-zip.org/) y volve a correr este script."
    exit 1
}

$TempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("pbs-editor-ruby-setup-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $TempDir | Out-Null

try {
    $ArchivePath = Join-Path $TempDir $ArchiveName
    Write-Host "Descargando $DownloadUrl ..."
    Invoke-WebRequest -Uri $DownloadUrl -OutFile $ArchivePath

    Write-Host "Verificando SHA256 ..."
    $ActualSha256 = (Get-FileHash -Path $ArchivePath -Algorithm SHA256).Hash
    if ($ActualSha256 -ne $ExpectedSha256) {
        Write-Error "SHA256 no coincide - el archivo descargado no es de confianza, abortando.`nEsperado: $ExpectedSha256`nObtenido : $ActualSha256"
        exit 1
    }

    Write-Host "Extrayendo ..."
    $ExtractDir = Join-Path $TempDir 'extracted'
    & $SevenZipPath x $ArchivePath "-o$ExtractDir" -y | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Error "7z fallo al extraer el archivo (codigo $LASTEXITCODE)."
        exit 1
    }

    # El 7z trae todo dentro de una unica carpeta rubyinstaller-<version>-x64/;
    # se mueve su CONTENIDO (no la carpeta en si) a resources/ruby/, que es
    # donde el codigo Rust espera encontrar bin/ruby.exe directamente
    # (ver resolve_ruby_paths en src-tauri/src/commands.rs).
    $InnerDirs = Get-ChildItem -Path $ExtractDir -Directory
    if ($InnerDirs.Count -ne 1) {
        Write-Error "Se esperaba una unica carpeta dentro del 7z, se encontraron $($InnerDirs.Count)."
        exit 1
    }

    if (Test-Path $ResourcesDir) {
        Remove-Item -Path $ResourcesDir -Recurse -Force
    }
    New-Item -ItemType Directory -Path $ResourcesDir | Out-Null
    Get-ChildItem -Path $InnerDirs[0].FullName | Move-Item -Destination $ResourcesDir

    $RubyExe = Join-Path $ResourcesDir 'bin\ruby.exe'
    if (-not (Test-Path $RubyExe)) {
        Write-Error "La extraccion termino pero no se encontro $RubyExe - revisa el layout del 7z (puede haber cambiado de version a version)."
        exit 1
    }

    Set-Content -Path $VersionMarker -Value $RubyVersion -NoNewline
    Write-Host "Listo: Ruby portatil $RubyVersion instalado en $ResourcesDir"
}
finally {
    Remove-Item -Path $TempDir -Recurse -Force -ErrorAction SilentlyContinue
}
