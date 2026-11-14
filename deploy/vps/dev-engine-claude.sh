#!/bin/sh
set -eu
cd "$(dirname "$0")/../.."
realmodel() { docker compose -f deploy/vps/factory-runner.yml exec -T factory-runner python3 /app/realmodel.py "$@"; }

MODE=${1:-all}
case "$MODE" in
    probe|check|remove) realmodel "$MODE"; exit $? ;;
    all) ;;
    *) echo "usage: sudo sh deploy/vps/dev-engine-claude.sh [probe|check|remove]"; exit 2 ;;
esac

STATE=$(realmodel check) || { echo "No answer from the runner. Is it up? sudo docker compose -f deploy/vps/factory-runner.yml up -d"; exit 1; }
printf '%s\n' "$STATE"
case "$STATE" in
    *connection=absent*)
        trap 'stty echo 2>/dev/null || true' EXIT INT TERM
        printf 'Token from "claude setup-token" (hidden, Enter to cancel): '
        stty -echo 2>/dev/null || true
        read -r TOKEN || TOKEN=''
        stty echo 2>/dev/null || true
        echo
        [ -n "$TOKEN" ] || { echo "Cancelled: nothing sent."; exit 0; }
        printf '%s\n' "$TOKEN" | realmodel connect
        TOKEN=
        ;;
esac
realmodel probe
