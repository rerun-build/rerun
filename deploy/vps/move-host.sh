#!/bin/sh
set -eu
cd "$(dirname "$0")/../.."

NEW=${1:-}
SUPA=${SUPABASE_ENV:-/docker/supabase-rerun/.env}
bad() { echo "Give the new host name, like moldwright.robagentic.tech. Nothing was changed."; exit 1; }
case "$NEW" in ''|*[!a-z0-9.-]*|.*|*.|*..*) bad ;; *.*) ;; *) bad ;; esac
[ -f .env ] && [ -w .env ] || { echo "Cannot write .env here (run as root from the repo). Nothing was changed."; exit 1; }
[ -f "$SUPA" ] && [ -w "$SUPA" ] || { echo "Cannot write $SUPA (set SUPABASE_ENV). Nothing was changed."; exit 1; }

umask 077
T=''
trap 'rm -f "$T"' EXIT
trap 'exit 1' INT TERM

value_in() { sed -n "s/^$2=//p" "$1" | tail -n 1 | sed "s/^'\(.*\)'\$/\1/; s/^\"\(.*\)\"\$/\1/"; }

put() {
    T=$(mktemp "$1.XXXXXX")
    K="$2" V="$3" Q="$4" awk 'BEGIN { k = ENVIRON["K"]; q = ENVIRON["Q"]; line = k "=" q ENVIRON["V"] q }
        $0 ~ "^" k "=" { if (!done) print line; done = 1; next } { print }
        END { if (!done) print line }' "$1" > "$T" && mv "$T" "$1"
    T=''
}

OLD=$(value_in .env RERUN_APP_HOST)
if [ -n "$OLD" ] && [ "$OLD" != "$NEW" ]; then put .env RERUN_OLD_APP_HOST "$OLD" "'"; fi
put .env RERUN_APP_HOST "$NEW" "'"
put .env NEXT_PUBLIC_APP_URL "https://$NEW" "'"
if [ -n "$(value_in .env RERUN_OLD_APP_HOST)" ]; then
    files=$(value_in .env COMPOSE_FILE)
    case ":$files:" in
        *:deploy/vps/moved-host.yml:*) ;;
        *) put .env COMPOSE_FILE "${files:-docker-compose.yml:deploy/vps/docker-compose.vps.yml}:deploy/vps/moved-host.yml" "'" ;;
    esac
fi

put "$SUPA" SITE_URL "https://$NEW" ""
urls=$(value_in "$SUPA" ADDITIONAL_REDIRECT_URLS)
case ",$urls," in
    *",https://$NEW/**,"*) ;;
    *) put "$SUPA" ADDITIONAL_REDIRECT_URLS "${urls:+$urls,}https://$NEW/**" "" ;;
esac

echo "The app is set to https://$NEW; $(value_in .env RERUN_OLD_APP_HOST) will redirect there."
echo "Next: cd $(dirname "$SUPA") && docker compose up -d auth"
echo "Then: cd $(pwd) && sh deploy/vps/update.sh"
