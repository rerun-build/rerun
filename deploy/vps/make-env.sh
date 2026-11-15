#!/bin/sh
set -eu
cd "$(dirname "$0")/../.."

SUPABASE_ENV=${SUPABASE_ENV:-/docker/supabase-rerun/.env}
APP_HOST=${RERUN_APP_HOST:-rerun.robagentic.tech}
ENGINE_HOST=${RERUN_ENGINE_HOST:-engine-rerun.robagentic.tech}
BUNDLE_KEYS='OPENROUTER_API_KEY RERUN_EMBED_API_KEY RERUN_ENGINE_API_KEY FOREMAN_HUB_TOKEN_SECRET BOARD_IMAGE_SECRET ADMIN_EMAILS SIGN_UP_EMAILS'

[ -f .env ] && { echo ".env exists already. Move it away first: mv .env .env.old"; exit 1; }
[ -r "$SUPABASE_ENV" ] || { echo "Cannot read $SUPABASE_ENV (run with sudo, or set SUPABASE_ENV)"; exit 1; }

value_in() { sed -n "s/^$2=//p" "$1" | tail -n 1 | sed "s/^'\(.*\)'\$/\1/; s/^\"\(.*\)\"\$/\1/"; }

put() {
    case "$2" in *"'"*) echo "The value of $1 contains a single quote, which .env cannot hold. Change it and run again."; rm -f .env; exit 1 ;; esac
    K="$1" V="$2" awk 'BEGIN { k = ENVIRON["K"]; line = k "=\047" ENVIRON["V"] "\047" }
        $0 ~ "^" k "=" { if (!done) print line; done = 1; next } { print }
        END { if (!done) print line }' .env > .env.tmp && mv .env.tmp .env
}

printf 'Paste the bundle from the PC, then Enter (it stays hidden): '
stty -echo 2>/dev/null || true
read -r BUNDLE
stty echo 2>/dev/null || true
echo
DECODED=$(printf '%s' "$BUNDLE" | base64 -d 2>/dev/null) || { echo "That is not the bundle: it does not decode."; exit 1; }
unset BUNDLE

umask 077
cp .env.example .env

SUPABASE_URL=$(value_in "$SUPABASE_ENV" SUPABASE_PUBLIC_URL)
[ -n "$SUPABASE_URL" ] || SUPABASE_URL=$(value_in "$SUPABASE_ENV" API_EXTERNAL_URL | sed 's#/auth/v1$##')
put NEXT_PUBLIC_SUPABASE_URL "$SUPABASE_URL"
put NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY "$(value_in "$SUPABASE_ENV" ANON_KEY)"
put SUPABASE_SECRET_KEY "$(value_in "$SUPABASE_ENV" SERVICE_ROLE_KEY)"
put SMTP_HOST "$(value_in "$SUPABASE_ENV" SMTP_HOST)"
put SMTP_PORT "$(value_in "$SUPABASE_ENV" SMTP_PORT)"
put SMTP_USER "$(value_in "$SUPABASE_ENV" SMTP_USER)"
put SMTP_PASS "$(value_in "$SUPABASE_ENV" SMTP_PASS)"
put SMTP_FROM "$(value_in "$SUPABASE_ENV" SMTP_SENDER_NAME) <$(value_in "$SUPABASE_ENV" SMTP_ADMIN_EMAIL)>"

put COMPOSE_FILE docker-compose.yml:deploy/vps/docker-compose.vps.yml
put RERUN_APP_HOST "$APP_HOST"
put RERUN_ENGINE_HOST "$ENGINE_HOST"
put NEXT_PUBLIC_APP_URL "https://$APP_HOST"
put RERUN_ENGINE_BROWSER_URL "https://$ENGINE_HOST"

hex() { if command -v openssl >/dev/null 2>&1; then openssl rand -hex "$1"; else od -An -N"$1" -tx1 /dev/urandom | tr -d ' \n'; fi; }
put WEBGATE_KEY "$(hex 32)"
put SEARXNG_SECRET "$(hex 32)"
for key in MOBILE_OAUTH_TICKET_SECRET PUBLISHED_ACCESS_SECRET UNSUBSCRIBE_SECRET; do put "$key" "$(hex 32)"; done
put CRAWL4AI_URL "${CRAWL4AI_URL:-https://crawl4ai.robagentic.tech}"

missing=''
for key in $BUNDLE_KEYS; do
    value=$(printf '%s\n' "$DECODED" | sed -n "s/^$key=//p" | tail -n 1)
    if [ -n "$value" ]; then put "$key" "$value"; else missing="$missing $key"; fi
done
unset DECODED value

for key in NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY SUPABASE_SECRET_KEY SMTP_PASS; do
    [ -n "$(value_in .env "$key")" ] || missing="$missing $key"
done
[ -n "$(value_in .env CRAWL4AI_TOKEN)" ] || missing="$missing CRAWL4AI_TOKEN(sudo sh deploy/vps/add-web.sh)"

echo "Wrote .env for https://$APP_HOST (engine: https://$ENGINE_HOST)."
[ -z "$missing" ] || echo "Still empty:$missing"
