#!/bin/sh
set -e
if [ -n "${RERUN_API_KEY_FILE:-}" ]; then
    rerun_key_file="$RERUN_API_KEY_FILE"
    unset RERUN_API_KEY_FILE RERUN_API_KEY
    rerun_key=
    if [ -r "$rerun_key_file" ]; then IFS= read -r rerun_key < "$rerun_key_file" || :; fi
    if [ -z "$rerun_key" ]; then
        echo "docker-entrypoint: the file named by RERUN_API_KEY_FILE is missing or empty" >&2
        exit 1
    fi
elif [ -n "${RERUN_API_KEY:-}" ]; then
    rerun_key="$RERUN_API_KEY"
    unset RERUN_API_KEY
else
    unset RERUN_API_KEY
fi
if [ -n "${rerun_key:-}" ]; then
    RERUN_KEY_FD=3
    export RERUN_KEY_FD
    exec 3<<RERUN_KEY_END
$rerun_key
RERUN_KEY_END
    unset rerun_key
fi
if [ -x /usr/bin/tini ]; then exec /usr/bin/tini -- "$@"; fi
exec "$@"
