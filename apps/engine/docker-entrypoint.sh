#!/bin/sh
set -e
if [ -n "${RERUN_API_KEY:-}" ]; then
    rerun_key="$RERUN_API_KEY"
    unset RERUN_API_KEY
    RERUN_KEY_FD=3
    export RERUN_KEY_FD
    exec 3<<RERUN_KEY_END
$rerun_key
RERUN_KEY_END
    unset rerun_key
else
    unset RERUN_API_KEY
fi
if [ -x /usr/bin/tini ]; then exec /usr/bin/tini -- "$@"; fi
exec "$@"
