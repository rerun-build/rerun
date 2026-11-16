#!/bin/sh
set -eu
cd "$(dirname "$0")/../.."
[ -f .env ] || { echo "No .env here. Write it first: sh deploy/vps/make-env.sh"; exit 1; }
[ "$#" -gt 0 ] || { echo "Name the keys to set, e.g.: sudo sh deploy/vps/set-env.sh RERUN_GITHUB_MCP_CLIENT_ID"; exit 1; }

put() {
    case "$2" in *"'"*) echo "The value of $1 contains a single quote, which .env cannot hold. Nothing changed for it."; return 1 ;; esac
    K="$1" V="$2" awk 'BEGIN { k = ENVIRON["K"]; line = k "=\047" ENVIRON["V"] "\047" }
        $0 ~ "^" k "=" { if (!done) print line; done = 1; next } { print }
        END { if (!done) print line }' .env > .env.tmp && cat .env.tmp > .env && rm -f .env.tmp
}

changed=''
for key in "$@"; do
    case "$key" in *[!A-Z0-9_]*|'') echo "Skipping '$key': keys are capital letters, digits and _."; continue ;; esac
    printf '%s (hidden, Enter to keep): ' "$key"
    stty -echo 2>/dev/null || true
    read -r value || value=''
    stty echo 2>/dev/null || true
    echo
    [ -n "$value" ] || continue
    put "$key" "$value" || continue
    changed="$changed $key"
done
unset value

if [ -z "$changed" ]; then echo "Nothing changed."; exit 0; fi
echo "Set:$changed"
docker compose up -d app
