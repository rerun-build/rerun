#!/bin/sh
set -u
R=${KEEPER_ROOT:-}
BIN=$R/usr/local/sbin/rerun-keeper
SUM=$R/usr/local/sbin/rerun-keeper.sha256
UNITS=$R/etc/systemd/system
OUT=$R/var/lib/rerun-keeper
LOCK=$R/run/rerun-keeper.lock
PROC=$R/proc
CAP=${KEEPER_CAP:-120}
SENSE_CAP=${KEEPER_SENSE_CAP:-60}
PROJECTS="rerun rerun-factory rerun-code"
SELF=$(cd "$(dirname "$0")" && pwd)/$(basename "$0")

refuse_test_root() {
    if [ -n "$R" ] && [ "${KEEPER_TEST:-}" != 1 ]; then
        echo "KEEPER_ROOT is for the tests: unset it, or set KEEPER_TEST=1 in a test."
        exit 2
    fi
}

say() { echo "keeper: $*"; }

word() { printf '%s' "$1" | tr -cd 'A-Za-z0-9._:-' | cut -c1-64; }
text() { printf '%s' "$1" | tr -cd 'A-Za-z0-9 ._:-' | cut -c1-120; }

ROWS=
add() {
    n=$(word "$1")
    v=$(printf '%s' "$2" | tr -d '%')
    if [ -z "$v" ]; then
        row="{\"name\":\"$n\",\"value\":null,\"reason\":\"$(text "${3:-unknown}")\"}"
    elif printf '%s' "$v" | grep -Eqx -- '-?[0-9]+(\.[0-9]+)?'; then
        row="{\"name\":\"$n\",\"value\":$v,\"reason\":null}"
    else
        row="{\"name\":\"$n\",\"value\":\"$(word "$v")\",\"reason\":null}"
    fi
    ROWS=${ROWS:+$ROWS,}$row
}

HK=
hk() { HK=${HK:+$HK,}"{\"cmd\":\"$(word "$1")\",\"rc\":$2,\"s\":$3}"; }

ex() {
    cap=$1
    shift
    timeout -k 5 "$cap" docker compose --project-directory "$REPO" -f "$REPO/docker-compose.yml" "$@" </dev/null
}

host() {
    read -r l1 l5 l15 _ < "$PROC/loadavg" || true
    add load_1 "${l1:-}" "no loadavg"
    add load_5 "${l5:-}" "no loadavg"
    add load_15 "${l15:-}" "no loadavg"
    add cores "$(nproc 2>/dev/null)" "no nproc"
    add mem_available_kb "$(sed -n 's/^MemAvailable: *\([0-9]*\) kB$/\1/p' "$PROC/meminfo" 2>/dev/null)" "no meminfo"
    set -- $(timeout 10 df -Pk / 2>/dev/null | tail -n 1)
    add disk_size_kb "${2:-}" "df failed"
    add disk_free_kb "${4:-}" "df failed"
    timeout 20 docker system df --format '{{.Type}} {{.Size}}' > "$OUT/.df" 2>/dev/null || true
    add images_size "$(sed -n 's/^Images //p' "$OUT/.df")" "docker system df failed"
    add volumes_size "$(sed -n 's/^Local Volumes //p' "$OUT/.df")" "docker system df failed"
    add build_cache_size "$(sed -n 's/^Build Cache //p' "$OUT/.df")" "docker system df failed"
    timeout 30 docker stats --no-stream --format '{{.Name}} {{.CPUPerc}} {{.MemPerc}}' > "$OUT/.stats" 2>/dev/null || true
    for p in $PROJECTS; do
        for c in $(timeout 10 docker ps -a --filter "label=com.docker.compose.project=$p" --format '{{.Names}}' 2>/dev/null); do
            c=$(word "$c")
            set -- $(timeout 10 docker inspect -f '{{.State.Status}} {{.RestartCount}} {{.Image}}' "$c" 2>/dev/null)
            add "c.$c.state" "${1:-}" "inspect failed"
            add "c.$c.restarts" "${2:-}" "inspect failed"
            add "c.$c.image" "$(printf '%s' "${3:-}" | sed 's/^sha256://' | cut -c1-12)" "inspect failed"
            set -- $(grep "^$c " "$OUT/.stats")
            add "c.$c.cpu_pct" "${2:-}" "not running"
            add "c.$c.mem_pct" "${3:-}" "not running"
        done
    done
    rm -f "$OUT/.df" "$OUT/.stats"
}

installed() {
    case "$1" in
        mirror) ex 20 exec -T engine test -x /data/tools/bin/mirror ;;
        janitor) ex 20 exec -T engine sh -c 'ls /data/tools/factory*/janitor.py' >/dev/null 2>&1 ;;
        tools-update) ex 20 exec -T engine test -x /data/tools/bin/tools-update ;;
    esac
}

chore() {
    name=$1
    shift
    if ! installed "$name"; then
        say "$name is not installed yet: skipped"
        return 0
    fi
    t0=$(date +%s)
    ex "$CAP" exec -T engine "$@" > "$OUT/.hk" 2>&1
    rc=$?
    t=$(( $(date +%s) - t0 ))
    [ "$rc" = 124 ] && say "$name stopped at its cap of $CAP s"
    [ "$rc" = 0 ] || say "$name exit $rc: $(tail -n 1 "$OUT/.hk" | cut -c1-200)"
    rm -f "$OUT/.hk"
    hk "$name" "$rc" "$t"
}

run() {
    REPO=${1:-}
    if [ "$SELF" != "$BIN" ]; then
        echo "run the installed copy: sudo $BIN run <repo>"
        exit 2
    fi
    if [ "$(sha256sum "$BIN" | cut -d ' ' -f 1)" != "$(cat "$SUM" 2>/dev/null)" ]; then
        say "REFUSED: $BIN differs from the checksum update.sh recorded; nothing run. Rerun update.sh."
        exit 2
    fi
    [ -f "$REPO/docker-compose.yml" ] || { say "REFUSED: no docker-compose.yml in '$REPO'"; exit 2; }
    mkdir -p "$OUT" "$(dirname "$LOCK")"
    exec 9>"$LOCK"
    if ! flock -n 9; then
        say "another run is alive; nothing done"
        exit 0
    fi
    started=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    host
    skips=$(cat "$OUT/skips" 2>/dev/null || echo 0)
    if ex 20 ps --status running --services 2>/dev/null | grep -qx engine; then
        echo 0 > "$OUT/skips"
        skips=0
        chore mirror /data/tools/bin/mirror refresh rerun
        chore janitor /data/tools/bin/wt janitor --apply
        chore tools-update /data/tools/bin/tools-update
        ex "$SENSE_CAP" exec -T engine /data/tools/bin/sense > "$OUT/.sense" 2>/dev/null
        if [ "$(wc -c < "$OUT/.sense")" -le 262144 ] && head -c 13 "$OUT/.sense" | grep -q '^{"version":1' && tail -c 3 "$OUT/.sense" | grep -q '}'; then
            factory=$(cat "$OUT/.sense")
        else
            factory='{"version":1,"readings":[],"reason":"sense gave no reading"}'
            say "sense gave no reading"
        fi
        engine=running
    else
        skips=$((skips + 1))
        echo "$skips" > "$OUT/skips"
        say "engine is not running: housekeeping and factory readings skipped ($skips in a row)"
        factory='{"version":1,"readings":[],"reason":"engine not running"}'
        engine=down
    fi
    rm -f "$OUT/.sense"
    printf '{"version":1,"madeAt":"%s","engine":"%s","skippedTicks":%s,"readings":[%s],"housekeeping":[%s],"factory":%s}\n' \
        "$started" "$engine" "$skips" "$ROWS" "$HK" "$factory" > "$OUT/.machine.json.tmp"
    chmod 644 "$OUT/.machine.json.tmp"
    mv "$OUT/.machine.json.tmp" "$OUT/machine.json"
    if [ "$engine" = running ]; then
        timeout 20 docker compose --project-directory "$REPO" -f "$REPO/docker-compose.yml" exec -T engine sh -c \
            'mkdir -p /data/work/state/keeper && cat > /data/work/state/keeper/.machine.json.tmp && mv /data/work/state/keeper/.machine.json.tmp /data/work/state/keeper/machine.json' \
            < "$OUT/machine.json" || say "copy into the engine failed"
    fi
}

case "${1:-}" in
    run)
        run "${2:-}"
        ;;
    install)
        refuse_test_root
        if [ "$SELF" = "$BIN" ]; then
            echo "run install from the clone: sudo sh deploy/vps/keeper.sh install"
            exit 2
        fi
        REPO=$(cd "$(dirname "$SELF")/../.." && pwd)
        mkdir -p "$(dirname "$BIN")" "$UNITS" "$OUT"
        install -m 755 "$SELF" "$BIN.tmp"
        sha256sum "$BIN.tmp" | cut -d ' ' -f 1 > "$SUM.tmp"
        mv "$BIN.tmp" "$BIN"
        mv "$SUM.tmp" "$SUM"
        chmod 644 "$SUM"
        printf '%s\n' '[Unit]' 'Description=Rerun machine keeper: housekeeping and readings (deploy/vps/keeper.sh)' 'After=docker.service' \
            '[Service]' 'Type=oneshot' "ExecStart=$BIN run $REPO" 'TimeoutStartSec=280' 'Nice=10' > "$UNITS/rerun-keeper.service"
        printf '%s\n' '[Unit]' 'Description=Rerun machine keeper every 5 minutes' '[Timer]' 'OnBootSec=2min' 'OnUnitActiveSec=5min' \
            'AccuracySec=30s' '[Install]' 'WantedBy=timers.target' > "$UNITS/rerun-keeper.timer"
        systemctl daemon-reload
        systemctl enable --now rerun-keeper.timer
        systemctl list-timers rerun-keeper.timer --no-pager
        ;;
    uninstall)
        refuse_test_root
        systemctl disable --now rerun-keeper.timer || true
        rm -f "$UNITS/rerun-keeper.service" "$UNITS/rerun-keeper.timer" "$BIN" "$SUM"
        systemctl daemon-reload
        echo "keeper removed"
        ;;
    *)
        echo "Usage: sudo sh deploy/vps/keeper.sh install|uninstall, or the installed copy: rerun-keeper run <repo>"
        exit 2
        ;;
esac
