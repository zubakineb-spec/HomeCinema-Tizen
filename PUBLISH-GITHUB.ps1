param(
    [string]$Remote = 'origin'
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'git is not installed.' }
if (-not (Test-Path '.git')) { throw 'This folder is not a Git checkout. Clone https://github.com/zubakineb-spec/HomeCinema-Tizen first.' }

$Branch = (git branch --show-current).Trim()
if (-not $Branch) { throw 'Cannot determine current branch.' }

$status = git status --porcelain
if ($status) {
    Write-Host 'Working tree contains uncommitted changes:'
    git status -sb
    throw 'Commit intended changes before publishing.'
}

Write-Host "Pushing branch $Branch to $Remote..."
git push -u $Remote $Branch
if ($LASTEXITCODE -ne 0) { throw "git push failed: $LASTEXITCODE" }

Write-Host 'Publishing local tags...'
git push $Remote --tags
if ($LASTEXITCODE -ne 0) { throw "git push --tags failed: $LASTEXITCODE" }
