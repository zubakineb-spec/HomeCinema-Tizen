$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
if (-not (Test-Path .venv)) { py -m venv .venv }
& .\.venv\Scripts\python.exe -m pip install -r .\backend\requirements.txt
$env:PYTHONPATH = (Resolve-Path .\backend).Path
& .\.venv\Scripts\python.exe .\backend\run.py
