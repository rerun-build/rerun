#!/bin/sh
set -eu
cd "$(dirname "$0")/../.."

[ -f .env ] || { echo "No .env here. Write it first: sh deploy/vps/make-env.sh"; exit 1; }
[ -w .env ] || { echo "Cannot write .env (run with sudo: sudo sh deploy/vps/add-router.sh)"; exit 1; }

umask 077
T=$(mktemp .env.XXXXXX)
trap 'stty echo 2>/dev/null || true; rm -f "$T"' EXIT
trap 'exit 1' INT TERM

value_in() { sed -n "s/^$2=//p" "$1" | tail -n 1 | sed "s/^'\(.*\)'\$/\1/; s/^\"\(.*\)\"\$/\1/"; }

put() {
    case "$2" in *"'"*) echo "The value of $1 contains a single quote, which .env cannot hold. Nothing was changed for it."; exit 1 ;; esac
    K="$1" V="$2" awk 'BEGIN { k = ENVIRON["K"]; line = k "=\047" ENVIRON["V"] "\047" }
        $0 ~ "^" k "=" { if (!done) print line; done = 1; next } { print }
        END { if (!done) print line }' .env > "$T" && mv "$T" .env && T=$(mktemp .env.XXXXXX)
}

hex() { if command -v openssl >/dev/null 2>&1; then openssl rand -hex "$1"; else od -An -N"$1" -tx1 /dev/urandom | tr -d ' \n'; fi; }

added=''
[ -n "$(value_in .env ROUTER_JWT_SECRET)" ] || { put ROUTER_JWT_SECRET "$(hex 32)"; added="$added ROUTER_JWT_SECRET"; }
[ -n "$(value_in .env ROUTER_API_KEY_SECRET)" ] || { put ROUTER_API_KEY_SECRET "$(hex 32)"; added="$added ROUTER_API_KEY_SECRET"; }

if [ -z "$(value_in .env ROUTER_HOST)" ]; then
    app=$(value_in .env RERUN_APP_HOST)
    [ -n "$app" ] || { echo "No RERUN_APP_HOST in .env to place the router beside."; exit 1; }
    put ROUTER_HOST "router.${app#*.}"
    added="$added ROUTER_HOST"
fi

if [ -z "$(value_in .env ROUTER_PASSWORD)" ]; then
    printf 'Choose the 9router dashboard password, at least 12 characters, then Enter (it stays hidden): '
    stty -echo 2>/dev/null || true
    PASS=''
    read -r PASS || true
    stty echo 2>/dev/null || true
    echo
    [ "${#PASS}" -ge 12 ] || { echo "Shorter than 12 characters: nothing was set for ROUTER_PASSWORD. Run this again."; exit 1; }
    put ROUTER_PASSWORD "$PASS"
    unset PASS
    added="$added ROUTER_PASSWORD"
fi

if [ -z "$(value_in .env ROUTER_ADMIN_CIDR)" ]; then
    printf 'IP range allowed to open the dashboard, such as 203.0.113.7/32 (Enter alone allows every address): '
    CIDR=''
    read -r CIDR || true
    case "$CIDR" in
        '') CIDR=0.0.0.0/0; echo "Every address can reach the dashboard login; set ROUTER_ADMIN_CIDR later to narrow it." ;;
        *[!0-9./:a-fA-F,]*) echo "Not an IP range: nothing was set for ROUTER_ADMIN_CIDR. Run this again."; exit 1 ;;
    esac
    put ROUTER_ADMIN_CIDR "$CIDR"
    added="$added ROUTER_ADMIN_CIDR"
fi

files=$(value_in .env COMPOSE_FILE)
case ":$files:" in
    *:deploy/vps/router.yml:*) ;;
    *) put COMPOSE_FILE "${files:-docker-compose.yml:deploy/vps/docker-compose.vps.yml}:deploy/vps/router.yml"; added="$added COMPOSE_FILE" ;;
esac

echo "Added or updated:${added:- nothing}"
echo "ROUTER_PASSWORD is only the first login: once you change the password in the dashboard, that one counts."
echo "Next: point a DNS A record for $(value_in .env ROUTER_HOST) at this server, then run: sh deploy/vps/update.sh"
