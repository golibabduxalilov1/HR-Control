# Dev helper: .\dev.ps1 backend | frontend | seed | stop | test
param([string]$cmd = "help")
$root = $PSScriptRoot
switch ($cmd) {
  "backend"  { Set-Location "$root\backend"; & .\.venv\Scripts\python.exe -m uvicorn app.main:app --port 8000 --reload }
  "frontend" { Set-Location "$root\frontend"; npm run dev }
  "seed"     { Set-Location "$root\backend"; & .\.venv\Scripts\python.exe -m app.db.seed demo }
  "test"     { Set-Location "$root\backend"; & .\.venv\Scripts\python.exe -m pytest -q }
  "stop"     { Get-Process python -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*uvicorn*" } | Stop-Process -Force; "backend stopped" }
  default    { "usage: .\dev.ps1 backend | frontend | seed | test | stop" }
}
