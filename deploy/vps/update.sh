#!/bin/sh
set -eu
cd "$(dirname "$0")/../.."
REPO=$(pwd)
SUPABASE_DIR=${SUPABASE_DIR:-/docker/supabase-rerun}
SUPABASE_DB_CONTAINER=${SUPABASE_DB_CONTAINER:-supabase-db}
SUPABASE_CLI=${SUPABASE_CLI:-supabase@2.113.0}
OWNER=$(stat -c '%u:%g' "$REPO")

echo "== 1/4 code"
su "$(stat -c '%U' "$REPO")" -s /bin/sh -c "git -C '$REPO' pull --ff-only"

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

echo "== 3/4 database migrations"
PW=$(sed -n 's/^POSTGRES_PASSWORD=//p' "$SUPABASE_DIR/.env" | tail -n 1 | sed "s/^'\(.*\)'\$/\1/; s/^\"\(.*\)\"\$/\1/")
[ -n "$PW" ] || { echo "No POSTGRES_PASSWORD in $SUPABASE_DIR/.env"; exit 1; }
NET=$(docker inspect "$SUPABASE_DB_CONTAINER" -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}')
SUPABASE_DB_URL="postgresql://postgres:$PW@db:5432/postgres?sslmode=disable"
export SUPABASE_DB_URL
docker run --rm --network "$NET" -v "$REPO/supabase:/work/supabase" -w /work --user "$OWNER" -e HOME=/tmp -e SUPABASE_DB_URL node:26 \
    sh -c "npx -y $SUPABASE_CLI db push --include-all --yes --db-url \"\$SUPABASE_DB_URL\""
unset PW SUPABASE_DB_URL

echo "== 4/4 restart"
docker compose up -d
docker compose ps
docker image prune -f
