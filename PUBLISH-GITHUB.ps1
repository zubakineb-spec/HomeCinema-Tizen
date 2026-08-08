$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { throw 'GitHub CLI (gh) is not installed.' }
gh auth status
$Repo = 'zubakineb-spec/HomeCinema-Tizen'
if (-not (Test-Path .git)) {
  git init -b main
  git add .
  git commit -m 'Home Cinema v0.1.0 MVP'
  git tag -a v0.1.0 -m 'Home Cinema v0.1.0'
}
$exists = $true
try { gh repo view $Repo --json nameWithOwner *> $null } catch { $exists = $false }
if (-not $exists) {
  gh repo create $Repo --private --source . --remote origin --push
} else {
  if (-not (git remote get-url origin 2>$null)) { git remote add origin "https://github.com/$Repo.git" }
  git push -u origin main
}
git push origin v0.1.0
