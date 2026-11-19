#!/bin/sh
cd "$(dirname "$0")/../.."

WAIT=${DOCTOR_WAIT_S:-180}
SINCE=${DOCTOR_SINCE:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}
fails=0
pass() { echo "PASS $1"; }
fail() { echo "FAIL $1"; fails=$((fails + 1)); }
value_in() { [ -f "$1" ] && sed -n "s/^$2=//p" "$1" | tail -n 1 | sed "s/^'\(.*\)'\$/\1/; s/^\"\(.*\)\"\$/\1/"; }

for key in RERUN_APP_HOST RERUN_ENGINE_HOST; do
    host=$(value_in .env "$key")
    [ -n "$host" ] || continue
    tried=0
    while :; do
        code=$(curl -s -o /dev/null -m 15 -w '%{http_code}' "https://$host/")
        case "$code" in 000|5??) ;; *) break ;; esac
        [ "$tried" -ge "$WAIT" ] && break
        sleep 10
        tried=$((tried + 10))
    done
    case "$code" in
        2??|3??|401|403) pass "https://$host answers ($code)" ;;
        *) fail "https://$host answers $code" ;;
    esac
done

old=$(value_in .env RERUN_OLD_APP_HOST)
for f in .env deploy/vps/.env; do
    [ -f "$f" ] && [ -n "$old" ] || continue
    keys=$(grep -E "^[A-Z0-9_]+=.*https?://$old" "$f" | sed 's/=.*//' | tr '\n' ' ')
    if [ -z "$keys" ]; then pass "$f points nothing at the old address $old"; else fail "$f still points at the old address $old: $keys"; fi
done

waited=0
logs=''
while :; do
    logs=$(docker compose logs --since 5m factory-dispatcher 2>/dev/null | awk -v s="$SINCE" '{ t = ""; for (i = 1; i < NF; i++) if ($i == "|") { t = $(i + 1); break } } t >= s')
    echo "$logs" | grep -q ' beat ' && break
    [ "$waited" -ge "$WAIT" ] && break
    sleep 15
    waited=$((waited + 15))
done
bad=$(echo "$logs" | grep -E 'HTTP [345][0-9][0-9]|could not start|cannot read' | tail -n 1 | sed 's/^[^|]*| //' | cut -c1-200)
if ! echo "$logs" | grep -q ' beat '; then
    fail "dispatcher: no beat in the last 5 minutes"
elif [ -n "$bad" ]; then
    fail "dispatcher: $bad"
else
    pass "dispatcher beats with no HTTP error in the last 5 minutes"
fi

if docker compose config --services 2>/dev/null | grep -qx factory-token; then
    at=$(docker compose exec -T factory-token stat -c %Y /token/token 2>/dev/null)
    case "$at" in
        ''|*[!0-9]*) fail "token: the App token file is missing" ;;
        *) age=$(( $(date +%s) - at )); if [ "$age" -lt 3600 ]; then pass "token renewed $age s ago"; else fail "token: last renewed $age s ago"; fi ;;
    esac
fi

if [ "$fails" -eq 0 ]; then echo "doctor: all checks pass"; else echo "doctor: $fails check(s) failed"; fi
[ "$fails" -eq 0 ]
