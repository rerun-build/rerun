#!/bin/sh
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
PREFIX=
KEYFILE=
VERSION=
READONLY="packet repo-check job-cost"
while [ $# -gt 0 ]; do
  case "$1" in
    --prefix) PREFIX=${2:-}; shift 2 ;;
    --jev-keyfile) KEYFILE=${2:-}; shift 2 ;;
    --version) VERSION=${2:-}; shift 2 ;;
    -h|--help) echo "usage: install.sh --prefix DIR --jev-keyfile P [--version SHA]"; exit 0 ;;
    *) echo "usage: install.sh --prefix DIR --jev-keyfile P [--version SHA]" >&2; exit 2 ;;
  esac
done
[ -n "$PREFIX" ] && [ -n "$KEYFILE" ] || { echo "usage: install.sh --prefix DIR --jev-keyfile P [--version SHA]" >&2; exit 2; }
grep -qx 'CLONE_SAFE = 1' "$HERE/factory.py" || { echo "REFUSED: factory.py lacks the line CLONE_SAFE = 1, so this tree is older than the clone-tolerant code. Nothing written." >&2; exit 2; }
if [ -z "$VERSION" ]; then
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
  rm -f "$PREFIX/bin/merge-dev"
  SHA=$(git -C "$HERE" rev-parse HEAD 2>/dev/null || echo unknown)
  printf '%s %s\n' "$SHA" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$PREFIX/.factory-installed.tmp"
  mv "$PREFIX/.factory-installed.tmp" "$PREFIX/factory-installed"
  echo "installed $(ls "$PREFIX/bin" | wc -l) wrappers into $PREFIX/bin"
  exit 0
fi
case "$VERSION" in *[!0-9a-f]*) echo "REFUSED: --version takes a commit id" >&2; exit 2 ;; esac
[ ${#VERSION} -ge 7 ] || { echo "REFUSED: --version takes a commit id" >&2; exit 2; }
mkdir -p "$PREFIX/bin"
PREFIX=$(cd "$PREFIX" && pwd)
exec 9>"$PREFIX/.install.lock"
flock -n 9 || { echo "TRANSIENT: another install is running; nothing done"; exit 3; }
DEST="$PREFIX/factory-$VERSION"
CUR=$(readlink "$PREFIX/factory-current" 2>/dev/null || true)
PREV=$(readlink "$PREFIX/factory-previous" 2>/dev/null || true)
if [ "$CUR" = "factory-$VERSION" ] && [ "$(cut -d' ' -f1 "$PREFIX/factory-installed" 2>/dev/null || true)" = "$VERSION" ]; then
  echo "factory-$VERSION is already the current copy"
  exit 0
fi
STAGE="$DEST.stage.$$"
rm -rf "$STAGE"
mkdir -p "$STAGE/triggers" "$STAGE/.bin"
trap 'rm -rf "$STAGE"' EXIT
for src in "$HERE"/*.py "$HERE"/*.json "$HERE"/*.mjs; do
  [ -e "$src" ] || continue
  f=$(basename "$src")
  case "$f" in test_*) continue ;; esac
  sed -e "s#/data/tools/factory#$DEST#g" -e "s#@@JEV_KEYFILE@@#$KEYFILE#g" "$src" > "$STAGE/$f"
done
cp "$HERE"/triggers/*.md "$STAGE/triggers/"
python3 -I -m py_compile "$STAGE"/*.py >/dev/null 2>&1 || { echo "REFUSED: factory-$VERSION does not compile; the current copy stays" >&2; exit 2; }
set +e
env -u FACTORY_CMD FACTORY_WORK="$STAGE/.selfcheck" python3 -I "$STAGE/factory.py" no-such-command >/dev/null 2>&1
rc=$?
set -e
[ "$rc" = 2 ] || { echo "REFUSED: factory-$VERSION failed its self-check (exit $rc); the current copy stays" >&2; exit 2; }
rm -rf "$STAGE/.selfcheck" "$STAGE/__pycache__"
for w in "$HERE"/bin/*; do
  n=$(basename "$w")
  ro=0
  for r in $READONLY; do [ "$r" = "$n" ] && ro=1; done
  {
    echo '#!/bin/sh'
    echo "D=\$(readlink -f \"$PREFIX/factory-current\")"
    if [ "$ro" = 1 ]; then
      grep -v '^#' "$w" | sed -e 's#exec ##' -e 's#/data/tools/factory#"$D"#g'
      echo 'rc=$?'
      echo "P=\$(readlink -f \"$PREFIX/factory-previous\" 2>/dev/null || true)"
      echo 'if [ "$rc" = 1 ] && [ -n "$P" ] && [ "$P" != "$D" ] && [ -d "$P" ]; then'
      echo "  echo \"FALLBACK: $n failed in \$D; ran the previous copy \$P\" >&2"
      grep -v '^#' "$w" | sed -e 's#exec ##' -e 's#/data/tools/factory#"$P"#g' -e 's#^#  #'
      echo '  exit $?'
      echo 'fi'
      echo 'exit $rc'
    else
      grep -v '^#' "$w" | sed -e 's#/data/tools/factory#"$D"#g'
    fi
  } > "$STAGE/.bin/$n"
  chmod 755 "$STAGE/.bin/$n"
done
if { [ "$CUR" = "factory-$VERSION" ] || [ "$PREV" = "factory-$VERSION" ]; } && [ -d "$DEST" ]; then
  rm -rf "$STAGE"
else
  rm -rf "$DEST"
  mv "$STAGE" "$DEST"
fi
trap - EXIT
OLD=$CUR
if [ "$OLD" = "factory-$VERSION" ]; then
  :
elif [ -n "$OLD" ]; then
  ln -sfn "$OLD" "$PREFIX/.previous.tmp"
  mv -T "$PREFIX/.previous.tmp" "$PREFIX/factory-previous"
elif [ -d "$PREFIX/factory" ]; then
  ln -sfn factory "$PREFIX/.previous.tmp"
  mv -T "$PREFIX/.previous.tmp" "$PREFIX/factory-previous"
fi
ln -sfn "factory-$VERSION" "$PREFIX/.current.tmp"
mv -T "$PREFIX/.current.tmp" "$PREFIX/factory-current"
for w in "$DEST"/.bin/*; do
  n=$(basename "$w")
  cp "$w" "$PREFIX/bin/.$n.tmp"
  mv -f "$PREFIX/bin/.$n.tmp" "$PREFIX/bin/$n"
done
rm -f "$PREFIX/bin/merge-dev"
echo "$VERSION $(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$PREFIX/.installed.tmp"
mv -f "$PREFIX/.installed.tmp" "$PREFIX/factory-installed"
echo "installed factory-$VERSION as the current copy (previous: $(readlink "$PREFIX/factory-previous" 2>/dev/null || echo none))"
