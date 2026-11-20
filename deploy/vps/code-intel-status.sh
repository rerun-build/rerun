#!/bin/sh
set -eu
cd "$(dirname "$0")/../.."

unquote() { v=${1#\"}; v=${v%\"}; v=${v#\'}; v=${v%\'}; printf '%s' "$v"; }
DATA=$(unquote "$(sed -n 's/^CODE_INTEL_DATA=//p' deploy/vps/.env 2>/dev/null | tail -n 1)")
[ -n "$DATA" ] || { echo "FAIL no CODE_INTEL_DATA in deploy/vps/.env"; exit 1; }
NET=$(unquote "$(sed -n 's/^CODE_INTEL_NETWORK=//p' deploy/vps/.env 2>/dev/null | tail -n 1)")
[ -n "$NET" ] || { echo "FAIL no CODE_INTEL_NETWORK in deploy/vps/.env"; exit 1; }

docker compose -f deploy/vps/code-intel.yml ps --all --format '{{.Service}} {{.State}}'

docker run --rm --network "$NET" --user 1001:1001 -e CODE_Q_CONFIG=/data/tools/etc/code-q.json -v "$DATA/tools:/data/tools:ro" -v "$DATA/work/repos:/data/work/repos:ro" node:26-alpine node /data/tools/factory-current/code-q.mjs --status
