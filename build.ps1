# Build CLIProxyAPI Plus (frontend embedded into the Go binary).
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "==> building web panel (web/ -> internal/webui/static)"
Push-Location web
npm install
npm run build
Pop-Location

Write-Host "==> building server binary"
go build -o cliproxyapi-plus.exe ./cmd/server

Write-Host "==> done: .\cliproxyapi-plus.exe"
