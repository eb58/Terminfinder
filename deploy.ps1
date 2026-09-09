param(
    [string] $Server = "56759440.ssh.w1.strato.hosting",
    [string] $User = "stu512072182",
    [int] $Port = 22,
    [string] $Webroot = "Seniorenclub",
    [string] $AppPath = "terminfinder",
    [switch] $WhatIfOnly
)

$ErrorActionPreference = "Stop"

$projectRoot = $PSScriptRoot
$appFiles = @(
    ".htaccess",
    "api.php",
    "app.js",
    "index.html",
    "logo.jpg",
    "styles.css"
)
$sshOpt = "-o UpdateHostKeys=no"
$remoteApp = "${Webroot}/${AppPath}"

# router.php bleibt bewusst draussen: der ist nur fuer "php -S" lokal, auf dem
# Apache uebernimmt .htaccess das Rewriting.

$uploadFiles = $appFiles | ForEach-Object {
    $path = Join-Path $projectRoot $_
    if (!(Test-Path -LiteralPath $path)) { throw "Datei fehlt: $path" }
    $path
}

if ($WhatIfOnly) {
    Write-Host "Wuerde nach ${User}@${Server}:${remoteApp}/ hochladen:" -ForegroundColor Yellow
    $appFiles | ForEach-Object { Write-Host "  $_" }
    exit 0
}

Write-Host "Bereinige Zielverzeichnis..." -ForegroundColor Cyan
# Whitelist-Cleanup statt blindem Ueberschreiben: entfernt Altlasten, laesst aber
# 'data' stehen - dort liegen die Umfragen (data/polls/*.json) und mail.log.
ssh -p $Port $sshOpt "${User}@${Server}" "mkdir -p '${remoteApp}/data/polls' && find '${remoteApp}' -mindepth 1 -maxdepth 1 ! -name 'data' -exec rm -rf -- {} \;"
if ($LASTEXITCODE -ne 0) {
    Write-Host "Remote-Verzeichnis konnte nicht vorbereitet werden." -ForegroundColor Red
    exit 1
}

Write-Host "Lade App hoch..." -ForegroundColor Cyan
# Dateien einzeln auflisten statt "*": scp expandiert Wildcards POSIX-artig und
# liesse dabei Punktdateien wie .htaccess aus - dann fehlt das Rewriting.
scp -P $Port $sshOpt @uploadFiles "${User}@${Server}:${remoteApp}/"
if ($LASTEXITCODE -ne 0) {
    Write-Host "Upload fehlgeschlagen." -ForegroundColor Red
    exit 1
}

Write-Host "Setze Dateirechte..." -ForegroundColor Cyan
ssh -p $Port $sshOpt "${User}@${Server}" "find '${remoteApp}' -type d -exec chmod 755 {} \; && find '${remoteApp}' -type f -exec chmod 644 {} \;"
if ($LASTEXITCODE -ne 0) {
    Write-Host "Dateirechte konnten nicht gesetzt werden." -ForegroundColor Red
    exit 1
}

Write-Host "Fertig! https://senioren-luebars.berlin/${AppPath}/" -ForegroundColor Green
