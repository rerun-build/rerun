#!/bin/sh
set -eu
cd "$(dirname "$0")/../.."
DEV=${DEV_ENGINE_CONTAINER:-rerun-dev-engine-dev-1}

say() { printf '%s\n' "$*"; }
dev() { docker exec "$DEV" "$@" </dev/null; }
devi() { docker exec -i "$DEV" "$@"; }
live_id() { docker compose ps -q engine | head -n 1; }
live_state() { docker inspect "$1" -f 'started={{.State.StartedAt}} restarts={{.RestartCount}} oomkilled={{.State.OOMKilled}}'; }

LIVE=$(live_id)
[ -n "$LIVE" ] || { say "P0 FAIL no live engine container found"; exit 1; }
BASE=$(live_state "$LIVE")

say "P0 live-engine $BASE"
say "P0 host-memory-free $(free -m | awk '/^Mem:/ {print $7 " MB available"}')"
say "P0 host-disk-free $(df -h / | awk 'NR==2 {print $4 " free"}')"

say "P1 mounts $(docker inspect "$DEV" -f '{{range .Mounts}}[{{.Type}} {{.Name}} -> {{.Destination}}] {{end}}')"
say "P1 privileged=$(docker inspect "$DEV" -f '{{.HostConfig.Privileged}}') capadd=$(docker inspect "$DEV" -f '{{.HostConfig.CapAdd}}') pidmode='$(docker inspect "$DEV" -f '{{.HostConfig.PidMode}}')' devices=$(docker inspect "$DEV" -f '{{len .HostConfig.Devices}}')"
say "P1 network-mode=$(docker inspect "$DEV" -f '{{.HostConfig.NetworkMode}}') port-bindings=$(docker inspect "$DEV" -f '{{json .HostConfig.PortBindings}}')"
ENVNAMES=$(docker inspect "$DEV" -f '{{range .Config.Env}}{{println .}}{{end}}' | sed 's/=.*//' | sort | tr '\n' ' ')
say "P1 env-names $ENVNAMES"
for V in RERUN_API_KEY RERUN_HUB_BASE_URL RERUN_PAIR_TOKEN RERUN_HUB_URL; do
    case " $ENVNAMES" in
        *" $V "*) say "P1 forbidden-variable $V PRESENT" ;;
        *) say "P1 forbidden-variable $V absent" ;;
    esac
done
say "P1 memory-limit=$(docker inspect "$DEV" -f '{{.HostConfig.Memory}}') nano-cpus=$(docker inspect "$DEV" -f '{{.HostConfig.NanoCpus}}') shm=$(docker inspect "$DEV" -f '{{.HostConfig.ShmSize}}')"
say "P1 log-config $(docker inspect "$DEV" -f '{{.HostConfig.LogConfig.Type}} {{json .HostConfig.LogConfig.Config}}')"

if dev test -e /data/hub.json; then say "P2 hub.json PRESENT"; else say "P2 hub.json absent"; fi
CODE=$(dev curl -s -o /dev/null -m 5 -w '%{http_code}' http://app:3000 2>/dev/null || true)
case "$CODE" in
    ''|000) say "P2 live-app-by-name unreachable (expected)" ;;
    *) say "P2 live-app-by-name REACHABLE http=$CODE" ;;
esac

say "P3 health http=$(dev curl -s -o /dev/null -m 5 -w '%{http_code}' http://localhost:3000/health || true)"

DEVKEY=$(sed -n 's/^RERUN_DEV_ENGINE_KEY=//p' deploy/vps/.env 2>/dev/null | tail -n 1)
[ -n "$DEVKEY" ] || { say "P4 FAIL no RERUN_DEV_ENGINE_KEY in deploy/vps/.env"; exit 1; }
dcurl() { T=$1; shift; printf 'Authorization: Bearer %s\n' "$DEVKEY" | docker exec -i "$DEV" curl -s -m "$T" -H @- "$@"; }
say "P4 no-key-request http=$(dev curl -s -o /dev/null -m 5 -w '%{http_code}' http://localhost:3000/agents || true)"
AG=$(dcurl 20 -X POST http://localhost:3000/agents -H 'content-type: application/json' \
    -d '{"config":{"name":"dev-probe"}}' | devi jq -r '.id // empty' || true)
if [ -n "$AG" ]; then
    TR=$(dcurl 20 -X POST "http://localhost:3000/agents/$AG/triggers" -H 'content-type: application/json' \
        -d '{"name":"probe","body":"Say hello."}' || true)
    SLUG=$(printf '%s' "$TR" | devi jq -r '.slug // empty' || true)
    TOK=$(printf '%s' "$TR" | devi jq -r '.token // empty' || true)
    FIRE=$(dcurl 30 -X POST "http://localhost:3000/agents/$AG/triggers/$SLUG/fire" -H 'content-type: application/json' \
        -d "{\"token\":\"$TOK\",\"method\":\"POST\"}" || true)
    TOK=
    RUN=$(printf '%s' "$FIRE" | devi jq -r '.runId // empty' || true)
    SES=$(printf '%s' "$FIRE" | devi jq -r '.sessionId // empty' || true)
    sleep 3
    ST=$(dcurl 10 "http://localhost:3000/agents/$AG/runs/$RUN" | devi jq -r '.status // empty' || true)
    say "P4 coworker=${AG:+created} trigger=${SLUG:+created} run-id=${RUN:-none} session-id=${SES:-none} run-status=${ST:-none}"
else
    say "P4 FAIL coworker not created"
fi

set +e
dev node -e "setTimeout(()=>Promise.reject(new Error('x')));setTimeout(()=>{},5000)" >/dev/null 2>&1
RC=$?
set -e
say "P5 node-unhandled-rejection exit-code=$RC"

P6=$(dcurl 10 -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -d '{}' \
    "http://localhost:3000/agents/none/runs/none/cancel" || true)
say "P6 dev-cancel-missing-run http=${P6:-none}"
DEVKEY=

P8=$(docker exec -e RERUN_API_KEY= "$DEV" sh -c '
    me=$$; n=0
    for f in /proc/[0-9]*/environ; do
        pid=${f#/proc/}; pid=${pid%/environ}
        [ "$pid" = "$me" ] && continue
        [ "$(awk "{print \$4}" "/proc/$pid/stat" 2>/dev/null)" = "$me" ] && continue
        if tr "\0" "\n" < "$f" 2>/dev/null | grep -q "^RERUN_API_KEY=."; then n=$((n+1)); fi
    done
    echo "$n"' </dev/null 2>/dev/null || echo err)
case "$P8" in
    0) say "P8 key-in-process-environment none" ;;
    err) say "P8 FAIL could not read process environments" ;;
    *) say "P8 FAIL RERUN_API_KEY is set in the environment of $P8 process(es)" ;;
esac

P8PID1=$(docker exec "$DEV" sh -c 'cat /proc/1/comm' </dev/null 2>/dev/null || echo err)
case "$P8PID1" in
    tini) say "P8 pid1-is-tini" ;;
    err) say "P8 FAIL could not read PID 1" ;;
    *) say "P8 FAIL PID 1 is $P8PID1, not tini" ;;
esac

P8REAP=$(docker exec "$DEV" sh -c '
    sh -c "(sleep 2 &)"; sleep 0.5
    p=$(for f in /proc/[0-9]*/stat; do awk "\$2==\"(sleep)\" && \$4==1 {print \$1}" "$f" 2>/dev/null; done | head -n 1)
    [ -n "$p" ] || { echo noparent; exit 0; }
    sleep 3
    [ ! -e "/proc/$p" ] && echo reaped || echo defunct' </dev/null 2>/dev/null || echo err)
case "$P8REAP" in
    reaped) say "P8 orphan-reaped" ;;
    err) say "P8 FAIL could not run the reaping probe" ;;
    *) say "P8 FAIL orphaned child $P8REAP" ;;
esac

AFTER=$(live_state "$LIVE")
say "P7 live-engine $AFTER"
if [ "$AFTER" = "$BASE" ]; then say "P7 live-engine unchanged"; else say "P7 live-engine CHANGED"; fi
