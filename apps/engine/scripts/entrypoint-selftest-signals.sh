#!/bin/sh
set -eu
fail() { echo "SELFTEST FAIL: $*" >&2; exit 1; }
dir=$(mktemp -d)
trap 'kill "${tpid:-0}" 2>/dev/null || true; rm -rf "$dir"' EXIT

tini -s -- node -e "
const fs = require('fs')
process.on('SIGTERM', () => { fs.writeFileSync('$dir/term', 'x'); process.exit(7) })
fs.writeFileSync('$dir/ready', 'x')
setInterval(() => {}, 1000)" &
tpid=$!
i=0
while [ ! -f "$dir/ready" ]; do
    i=$((i + 1)); [ "$i" -le 50 ] || fail "node did not start"; sleep 0.1
done
kill -TERM "$tpid"
rc=0; wait "$tpid" || rc=$?
tpid=
[ -f "$dir/term" ] || fail "SIGTERM did not reach node"
[ "$rc" -eq 7 ] || fail "tini exited $rc, not node's code 7"

tini -s -- sh -c '(sleep 1 &); sleep 4' &
tpid=$!
sleep 0.5
orphan=0
for f in /proc/[0-9]*/stat; do
    [ "$(awk '{print $2, $4}' "$f" 2>/dev/null)" = "(sleep) $tpid" ] && orphan=1
done
[ "$orphan" = 1 ] || fail "the orphaned grandchild was not re-parented to tini"
sleep 2
zombies=0
for f in /proc/[0-9]*/stat; do
    [ "$(awk '{print $3, $4}' "$f" 2>/dev/null)" = "Z $tpid" ] && zombies=$((zombies + 1))
done
[ "$zombies" -eq 0 ] || fail "$zombies defunct process(es) left under tini"
echo "selftest: SIGTERM reaches node (exit code kept), orphaned child reaped"
