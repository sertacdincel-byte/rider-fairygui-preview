# Builds build/distributions/FguiPreview-<version>.zip against the locally installed Rider.
# With -RepositoryUrl it also writes updatePlugins.xml for a custom plugin repository hosted at that URL.
# Usage: ./build.ps1 [-RiderHome <path>] [-SkipWeb] [-RepositoryUrl https://host/path]
param(
    [string]$RiderHome = "$env:LOCALAPPDATA\Programs\Rider",
    [switch]$SkipWeb,
    [string]$RepositoryUrl
)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$javac = Join-Path $RiderHome 'jbr\bin\javac.exe'
if (-not (Test-Path $javac)) { throw "javac not found at $javac; pass -RiderHome" }

if (-not $SkipWeb) {
    Push-Location (Join-Path $root 'web')
    try {
        if (-not (Test-Path 'node_modules')) { npm ci; if ($LASTEXITCODE) { throw 'npm ci failed' } }
        node build.mjs
        if ($LASTEXITCODE) { throw 'web build failed' }
    } finally { Pop-Location }
}

$build = Join-Path $root 'build'
$classes = Join-Path $build 'classes'
if (Test-Path $build) { Remove-Item $build -Recurse -Force }
New-Item -ItemType Directory -Force $classes | Out-Null

$cp = @(
    (Join-Path $RiderHome 'lib\*'),
    (Join-Path $RiderHome 'plugins\jcef-plugin\lib\*'),
    (Join-Path $RiderHome 'plugins\jcef-plugin\lib\modules\*')
) -join ';'
$sources = Get-ChildItem (Join-Path $root 'src\main\java') -Recurse -Filter *.java | ForEach-Object { $_.FullName }
& $javac --release 21 -encoding UTF-8 -nowarn -proc:none -cp $cp -d $classes @sources
if ($LASTEXITCODE) { throw 'javac failed' }

[xml]$descriptor = Get-Content (Join-Path $root 'src\main\resources\META-INF\plugin.xml') -Encoding UTF8
$plugin = $descriptor.'idea-plugin'
$version = $plugin.version

Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
function Add-Tree($zip, $dir, $prefix) {
    foreach ($f in Get-ChildItem $dir -Recurse -File) {
        $rel = $f.FullName.Substring($dir.Length).TrimStart('\').Replace('\', '/')
        [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $f.FullName, "$prefix$rel") | Out-Null
    }
}

$jar = Join-Path $build 'fguipreview.jar'
$z = [IO.Compression.ZipFile]::Open($jar, 'Create')
try {
    Add-Tree $z $classes ''
    Add-Tree $z (Join-Path $root 'src\main\resources') ''
} finally { $z.Dispose() }

$dist = Join-Path $build 'distributions'
New-Item -ItemType Directory -Force $dist | Out-Null
$zipPath = Join-Path $dist "FguiPreview-$version.zip"
$z = [IO.Compression.ZipFile]::Open($zipPath, 'Create')
try {
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($z, $jar, 'FguiPreview/lib/fguipreview.jar') | Out-Null
} finally { $z.Dispose() }
Write-Host "Built $zipPath"
Write-Host ("SHA-256 " + (Get-FileHash $zipPath -Algorithm SHA256).Hash)

if ($RepositoryUrl) {
    $zipName = Split-Path $zipPath -Leaf
    $base = $RepositoryUrl.TrimEnd('/')
    $esc = { param($s) [Security.SecurityElement]::Escape($s) }
    $repo = @"
<?xml version="1.0" encoding="UTF-8"?>
<plugins>
  <plugin id="$(& $esc $plugin.id)" url="$(& $esc "$base/$zipName")" version="$(& $esc $version)">
    <idea-version since-build="$(& $esc $plugin.'idea-version'.'since-build')"/>
    <name>$(& $esc $plugin.name)</name>
    <vendor>$(& $esc $plugin.vendor)</vendor>
    <description><![CDATA[$($plugin.description.'#cdata-section')]]></description>
    <change-notes><![CDATA[$($plugin.'change-notes'.'#cdata-section')]]></change-notes>
  </plugin>
</plugins>
"@
    $repoPath = Join-Path $dist 'updatePlugins.xml'
    [IO.File]::WriteAllText($repoPath, $repo, (New-Object Text.UTF8Encoding $false))
    Write-Host "Wrote $repoPath -> upload it next to $zipName at $base/"
}
