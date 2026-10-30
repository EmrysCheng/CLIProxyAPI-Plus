#!/usr/bin/env bash
# Build CLIProxyAPI Plus (frontend embedded into the Go binary).
set -euo pipefail
cd "$(dirname "$0")"

echo "==> building web panel (web/ -> internal/webui/static)"
(cd web && npm install && npm run build)

echo "==> building server binary"
go build -o cliproxyapi-plus ./cmd/server

echo "==> done: ./cliproxyapi-plus"
