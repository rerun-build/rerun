#!/bin/sh
set -eu
cd "$(dirname "$0")/../.."
REPO=$(pwd)
SUPABASE_DIR=${SUPABASE_DIR:-/docker/supabase-rerun}
SUPABASE_DB_CONTAINER=${SUPABASE_DB_CONTAINER:-supabase-db}
SUPABASE_CLI=${SUPABASE_CLI:-supabase@2.113.0}
OWNER=$(stat -c '%u:%g' "$REPO")
DISPATCHER=$(docker ps -qf name=factory-dispatcher | head -n 1)
[ "${NO_DRAIN:-0}" != 1 ] || DISPATCHER=

undrain() {
    [ -z "$DISPATCHER" ] || docker exec "$DISPATCHER" rm -f /state/drain /state/drain-left || echo "The drain mark could not be removed: the factory starts again by itself within 3 hours."
}

wait_drained() {
    [ -n "$DISPATCHER" ] || return 0
    echo "== waiting for the factory's running work to finish (NO_DRAIN=1 skips the wait)"
    waited=0
    while :; do
        left=$(docker exec "$DISPATCHER" cat /state/drain-left 2>/dev/null || echo "?")
        [ "$left" != 0 ] || break
        if [ "$left" = "?" ] && [ "$waited" -ge 180 ]; then
            echo "The dispatcher gave no count in 3 min: going on."
            break
        fi
        if [ "$waited" -ge 3600 ]; then
            echo "Still $left running after 60 min: going on."
            break
        fi
        echo "$left running, waited ${waited} s"
        sleep 30
        waited=$((waited + 30))
    done
}

echo "== 1/4 code"
su "$(stat -c '%U' "$REPO")" -s /bin/sh -c "git -C '$REPO' pull --ff-only"
[ "${UPDATE_PULLED:-0}" = 1 ] || UPDATE_PULLED=1 exec sh "$REPO/deploy/vps/update.sh"
docker compose config -q || { echo "The compose files do not resolve: set the values named above (factory ones in deploy/vps/.env), then run this again."; exit 1; }

trap undrain EXIT
trap 'exit 130' INT TERM HUP
if [ -n "$DISPATCHER" ]; then
    docker exec "$DISPATCHER" sh -c 'rm -f /state/drain-left; touch /state/drain' && echo "Factory: no new work starts until this update is done." || echo "Factory: the drain mark could not be set."
fi

echo "== snapshot of the coworker databases"
if ! docker compose ps --status running --services 2>/dev/null | grep -qx engine; then
    echo "Engine is not running: no snapshot."
elif ! docker compose exec -T engine node dist/cli/bin.js help 2>/dev/null | grep -q 'rerun snapshot'; then
    echo "Running engine has no snapshot command yet: no snapshot."
else
    docker compose exec -T engine node dist/cli/bin.js snapshot
fi

echo "== 2/4 images"
docker compose pull

wait_drained

echo "== 3/4 database migrations"
PW=$(sed -n 's/^POSTGRES_PASSWORD=//p' "$SUPABASE_DIR/.env" | tail -n 1 | sed "s/^'\(.*\)'\$/\1/; s/^\"\(.*\)\"\$/\1/")
[ -n "$PW" ] || { echo "No POSTGRES_PASSWORD in $SUPABASE_DIR/.env"; exit 1; }
NETS=$(docker inspect "$SUPABASE_DB_CONTAINER" -f '{{range $k,$v := .NetworkSettings.Networks}}{{println $k}}{{end}}' | sed '/^$/d')
NET=$(printf '%s\n' "$NETS" | grep -E 'supabase|default' | head -n 1 || true)
[ -n "$NET" ] || NET=$(printf '%s\n' "$NETS" | head -n 1)
export PW
docker run --rm --network "$NET" -v "$REPO/supabase:/work/supabase" -w /work --user "$OWNER" -e HOME=/tmp -e PW node:26 \
    node -e 'const { spawnSync } = require("node:child_process"); const url = `postgresql://postgres:${encodeURIComponent(process.env.PW || "")}@db:5432/postgres?sslmode=disable`; process.exit(spawnSync("npx", ["-y", process.argv[1], "db", "push", "--include-all", "--yes", "--db-url", url], { stdio: "inherit", env: { ...process.env, PW: "" } }).status ?? 1)' "$SUPABASE_CLI"
unset PW
echo "== 4/4 restart"
if docker compose config --services | grep -qx factory-dispatcher; then
    OLD=$(docker ps -aq --filter label=com.docker.compose.project=rerun-factory)
    if [ -n "$OLD" ]; then
        docker compose build factory-dispatcher
        echo "The factory moves into this project: its old container stops first, its data stays."
        docker stop -t 150 $OLD
        docker rm $OLD
        DISPATCHER=
    fi
fi
docker compose up -d
DISPATCHER=$(docker ps -qf name=factory-dispatcher | head -n 1)
docker compose ps
docker image prune -f
echo "== keeper"
sh deploy/vps/keeper.sh install || echo "keeper install failed: the copy installed before stays"
echo "== doctor"
sh deploy/vps/doctor.sh || echo "The checks above found a problem. The deploy itself is done."
