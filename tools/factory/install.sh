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
grep -qx 'CLONE_SAFE = 1' "$HERE/factory.py" || { echo "REFUSED: factory.py lacks the line CLONE_SAFE = 1, so this tree is older than the clone-tolerant code. Nothing written." >&2; exit 2; }
mkdir -p "$PREFIX/bin" "$PREFIX/factory"
PREFIX=$(cd "$PREFIX" && pwd)
for src in "$HERE"/*.py "$HERE"/*.json "$HERE"/*.mjs; do
  f=$(basename "$src")
  case "$f" in test_*) continue ;; esac
  sed -e "s#/data/tools/factory#$PREFIX/factory#g" -e "s#@@JEV_KEYFILE@@#$KEYFILE#g" "$src" > "$PREFIX/factory/$f"
done
mkdir -p "$PREFIX/factory/triggers"
cp "$HERE"/triggers/*.md "$PREFIX/factory/triggers/"
for w in "$HERE"/bin/*; do
  n=$(basename "$w")
  sed "s#/data/tools/factory#$PREFIX/factory#g" "$w" > "$PREFIX/bin/$n"
  chmod 755 "$PREFIX/bin/$n"
done
SHA=$(git -C "$HERE" rev-parse HEAD 2>/dev/null || echo unknown)
printf '%s %s\n' "$SHA" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$PREFIX/.factory-installed.tmp"
mv "$PREFIX/.factory-installed.tmp" "$PREFIX/factory-installed"
echo "installed $(ls "$PREFIX/bin" | wc -l) wrappers into $PREFIX/bin"
