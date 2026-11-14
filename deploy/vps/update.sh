#!/bin/sh
# Updates Rerun on the server in one go: new code, the images GitHub built, the database migrations
# that came with them, then a restart, then the images it replaced are removed. Run from the clone:
#   sudo sh deploy/vps/update.sh
# Every step prints as it goes. Nothing secret is printed: the database password is read into a
# variable and only handed to the migration container.
set -eu
cd "$(dirname "$0")/../.."
REPO=$(pwd)
SUPABASE_DIR=${SUPABASE_DIR:-/docker/supabase-rerun}
SUPABASE_DB_CONTAINER=${SUPABASE_DB_CONTAINER:-supabase-db}
# Same CLI version as the repository's lockfile pins.
SUPABASE_CLI=${SUPABASE_CLI:-supabase@2.113.0}
OWNER=$(stat -c '%u:%g' "$REPO")

echo "== 1/4 code"
# The clone belongs to the login user, not root: pull as that user so git keeps working for them.
su "$(stat -c '%U' "$REPO")" -s /bin/sh -c "git -C '$REPO' pull --ff-only"

echo "== snapshot of the coworker databases"
# A copy before anything changes. No running engine, or one older than the snapshot command, is skipped
# with one line; any other failure stops the script here.
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
# Only supabase/ is mounted: the CLI would otherwise try to read Rerun's root-only .env. --include-all
# applies upstream migrations dated before ones already applied here; they are written to be rerun.
docker run --rm --network "$NET" -v "$REPO/supabase:/work/supabase" -w /work --user "$OWNER" -e HOME=/tmp node:26 \
    npx -y "$SUPABASE_CLI" db push --include-all --yes --db-url "postgresql://postgres:$PW@db:5432/postgres?sslmode=disable"
unset PW

echo "== 4/4 restart"
docker compose up -d
docker compose ps
# The pull left the images it replaced without a tag. Remove untagged images that no container uses, and
# nothing else: an older build comes back from the registry with RERUN_IMAGE_TAG=sha-<commit>.
docker image prune -f
