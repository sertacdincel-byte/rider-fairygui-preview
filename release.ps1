# Publishes the version in plugin.xml as a GitHub release with the plugin zip and updatePlugins.xml.
# Rider users who added .../releases/latest/download/updatePlugins.xml as a plugin repository get it as an update.
# Usage: ./release.ps1 [-RiderHome <path>] [-Draft]
param(
    [string]$RiderHome = "$env:LOCALAPPDATA\Programs\Rider",
    [switch]$Draft
)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
Push-Location $root
try {
    [xml]$descriptor = Get-Content 'src\main\resources\META-INF\plugin.xml' -Encoding UTF8
    $version = $descriptor.'idea-plugin'.version
    $sinceBuild = $descriptor.'idea-plugin'.'idea-version'.'since-build'
    $tag = "v$version"

    if (git status --porcelain) { throw 'Working tree is not clean; commit first.' }
    if (git tag --list $tag) { throw "Tag $tag already exists; bump <version> in plugin.xml." }
    $repo = gh repo view --json nameWithOwner --jq .nameWithOwner
    if ($LASTEXITCODE) { throw 'gh repo view failed' }
    gh release view $tag --repo $repo *> $null
    if (-not $LASTEXITCODE) { throw "Release $tag already exists on $repo." }

    $changelog = Get-Content 'CHANGELOG.md' -Raw -Encoding UTF8
    $m = [regex]::Match($changelog, "(?ms)^## $([regex]::Escape($version))\b[^\n]*\n(.*?)(?=^## |\z)")
    if (-not $m.Success) { throw "CHANGELOG.md has no '## $version' section." }

    # The committed preview.html is what gets released; run ./build.ps1 and commit before releasing page changes.
    & (Join-Path $root 'build.ps1') -RiderHome $RiderHome -SkipWeb -RepositoryUrl "https://github.com/$repo/releases/download/$tag"
    $zip = "build\distributions\FguiPreview-$version.zip"
    $xml = 'build\distributions\updatePlugins.xml'
    $sha = (Get-FileHash $zip -Algorithm SHA256).Hash

    git push origin HEAD
    if ($LASTEXITCODE) { throw 'git push failed' }

    $notes = @"
$($m.Groups[1].Value.Trim())

**Install or update**
- Plugin repository (updates arrive automatically): Rider → Settings → Plugins → ⚙ → Manage Plugin Repositories… → add ``https://github.com/$repo/releases/latest/download/updatePlugins.xml``, then install *FairyGUI Preview* from the Marketplace tab.
- From disk: download ``FguiPreview-$version.zip`` → Settings → Plugins → ⚙ → Install Plugin from Disk… → restart.

Requires Rider build $sinceBuild or later.

SHA-256 ``FguiPreview-$version.zip``: ``$sha``
"@
    $ghArgs = @('release', 'create', $tag, $zip, $xml, '--repo', $repo, '--title', "FairyGUI Preview $version", '--notes', $notes, '--target', (git rev-parse HEAD))
    if ($Draft) { $ghArgs += '--draft' }
    gh @ghArgs
    if ($LASTEXITCODE) { throw 'gh release create failed' }
    git fetch --tags --quiet
} finally { Pop-Location }
