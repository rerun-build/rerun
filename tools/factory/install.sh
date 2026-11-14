#!/bin/sh
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
PREFIX=
KEYFILE=
while [ $# -gt 0 ]; do
  case "$1" in
    --prefix) PREFIX=${2:-}; shift 2 ;;
    --jev-keyfile) KEYFILE=${2:-}; shift 2 ;;
    -h|--help) echo "usage: install.sh --prefix DIR --jev-keyfile P"; exit 0 ;;
    *) echo "usage: install.sh --prefix DIR --jev-keyfile P" >&2; exit 2 ;;
  esac
done
[ -n "$PREFIX" ] && [ -n "$KEYFILE" ] || { echo "usage: install.sh --prefix DIR --jev-keyfile P" >&2; exit 2; }
mkdir -p "$PREFIX/bin" "$PREFIX/factory"
PREFIX=$(cd "$PREFIX" && pwd)
for f in gate.py factory.py jobcost.py trigger.py engine.py store.py limits.py readyq.py batch.py evidence.py ghclient.py intake.py ledger.py roster.py runner_loop.py wake.py status_report.py checkout.py applypatch.py testrun.py publish.py followups.py measures.py runner.json; do
  sed -e "s#/data/tools/factory#$PREFIX/factory#g" -e "s#@@JEV_KEYFILE@@#$KEYFILE#g" "$HERE/$f" > "$PREFIX/factory/$f"
done
mkdir -p "$PREFIX/factory/triggers"
cp "$HERE"/triggers/*.md "$PREFIX/factory/triggers/"
for w in "$HERE"/bin/*; do
  n=$(basename "$w")
  sed "s#/data/tools/factory#$PREFIX/factory#g" "$w" > "$PREFIX/bin/$n"
  chmod 755 "$PREFIX/bin/$n"
done
echo "installed $(ls "$PREFIX/bin" | wc -l) wrappers into $PREFIX/bin"
