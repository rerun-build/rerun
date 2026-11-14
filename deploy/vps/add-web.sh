#!/bin/sh
set -eu
cd "$(dirname "$0")/../.."

[ -f .env ] || { echo "No .env here. Write it first: sh deploy/vps/make-env.sh"; exit 1; }
[ -w .env ] || { echo "Cannot write .env (run with sudo: sudo sh deploy/vps/add-web.sh)"; exit 1; }

umask 077
trap 'stty echo 2>/dev/null || true; rm -f .env.tmp' EXIT
trap 'exit 1' INT TERM

value_in() { sed -n "s/^$2=//p" "$1" | tail -n 1 | sed "s/^'\(.*\)'\$/\1/; s/^\"\(.*\)\"\$/\1/"; }

put() {
    case "$2" in *"'"*) echo "The value of $1 contains a single quote, which .env cannot hold. Nothing was changed for it."; exit 1 ;; esac
    K="$1" V="$2" awk 'BEGIN { k = ENVIRON["K"]; line = k "=\047" ENVIRON["V"] "\047" }
        $0 ~ "^" k "=" { if (!done) print line; done = 1; next } { print }
        END { if (!done) print line }' .env > .env.tmp && mv .env.tmp .env
}

hex() { if command -v openssl >/dev/null 2>&1; then openssl rand -hex "$1"; else od -An -N"$1" -tx1 /dev/urandom | tr -d ' \n'; fi; }

added=''
[ -n "$(value_in .env WEBGATE_KEY)" ] || { put WEBGATE_KEY "$(hex 32)"; added="$added WEBGATE_KEY"; }
[ -n "$(value_in .env SEARXNG_SECRET)" ] || { put SEARXNG_SECRET "$(hex 32)"; added="$added SEARXNG_SECRET"; }
[ -n "$(value_in .env CRAWL4AI_URL)" ] || { put CRAWL4AI_URL "${CRAWL4AI_URL:-https://crawl4ai.robagentic.tech}"; added="$added CRAWL4AI_URL"; }

printf 'Paste the crawl4ai token (its CRAWL4AI_API_TOKEN), then Enter (it stays hidden; Enter alone keeps the current one): '
stty -echo 2>/dev/null || true
TOKEN=''
read -r TOKEN || true
stty echo 2>/dev/null || true
echo
if [ -n "$TOKEN" ]; then put CRAWL4AI_TOKEN "$TOKEN"; added="$added CRAWL4AI_TOKEN"; fi
unset TOKEN

echo "Added or updated:${added:- nothing}"
[ -n "$(value_in .env CRAWL4AI_TOKEN)" ] || echo "CRAWL4AI_TOKEN is still empty: run this again and paste the token."
