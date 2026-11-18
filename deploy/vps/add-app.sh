#!/bin/sh
set -eu
cd "$(dirname "$0")/../.."

APP_ID=5822204
INSTALLATION=183438800
KEYS=${FACTORY_KEYS_DIR:-/docker/rerun-factory-keys}
OWNER=${FACTORY_KEY_OWNER:-10001:10001}
KEYFILE="$KEYS/moldwright-factory.pem"

[ -f .env ] || { echo "No .env here. Write it first: sh deploy/vps/make-env.sh"; exit 1; }
[ -w .env ] || { echo "Cannot write .env (run as root)"; exit 1; }

umask 077
T=$(mktemp .env.XXXXXX)
K=$(mktemp)
trap 'rm -f "$T" "$K"' EXIT
trap 'exit 1' INT TERM

value_in() { sed -n "s/^$2=//p" "$1" | tail -n 1 | sed "s/^'\(.*\)'\$/\1/; s/^\"\(.*\)\"\$/\1/"; }

put() {
    K2="$1" V="$2" awk 'BEGIN { k = ENVIRON["K2"]; line = k "=\047" ENVIRON["V"] "\047" }
        $0 ~ "^" k "=" { if (!done) print line; done = 1; next } { print }
        END { if (!done) print line }' .env > "$T" && mv "$T" .env && T=$(mktemp .env.XXXXXX)
}

echo "Paste the moldwright-factory private key (the whole .pem text), then press Enter and Ctrl-D:" >&2
cat > "$K"
grep -q -- '-----BEGIN .*PRIVATE KEY-----' "$K" && grep -q -- '-----END .*PRIVATE KEY-----' "$K" \
    || { echo "That is not a private key: nothing was changed. Run this again and paste the whole .pem text."; exit 1; }
if command -v openssl >/dev/null 2>&1; then
    openssl pkey -in "$K" -noout 2>/dev/null || { echo "openssl cannot read that key: nothing was changed. Paste the whole .pem text."; exit 1; }
fi

mkdir -p "$KEYS"
[ ! -e "$KEYFILE" ] || chmod 600 "$KEYFILE"
cp "$K" "$KEYFILE"
chown "$OWNER" "$KEYFILE"
chmod 400 "$KEYFILE"

put FACTORY_APP_KEY_FILE "$KEYFILE"
put FACTORY_APP_ID "$APP_ID"
put FACTORY_APP_INSTALLATION "$INSTALLATION"
files=$(value_in .env COMPOSE_FILE)
case ":$files:" in
    *:deploy/vps/factory-app.yml:*) ;;
    *) put COMPOSE_FILE "${files:-docker-compose.yml:deploy/vps/docker-compose.vps.yml}:deploy/vps/factory-app.yml" ;;
esac

echo "Key stored in $KEYFILE (mode 400). App $APP_ID, installation $INSTALLATION."
echo "Next: sh deploy/vps/update.sh"
