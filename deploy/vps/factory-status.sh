#!/bin/sh
set -eu
cd "$(dirname "$0")/../.."
exec docker compose -f deploy/vps/factory-runner.yml exec -T factory-runner python3 -I /app/status_report.py "$@"
