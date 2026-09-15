#!/usr/bin/env bash
# DEV-ONLY helper: restart the local PGlite database and the app together.
# PGlite's socket server accepts a single client, so a force-killed app leaves
# the slot orphaned — always cycle both.
set -u
cd "$(dirname "$0")/.."

powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { \$_.CommandLine -like '*pglite-server*' -or \$_.CommandLine -like '*src/server.js*' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force }" >/dev/null 2>&1
sleep 2

nohup node scripts/pglite-server.mjs > .pglite.log 2>&1 &
sleep 6
nohup node src/server.js > .server.log 2>&1 &
sleep 6

curl -s http://localhost:3000/healthz
echo
