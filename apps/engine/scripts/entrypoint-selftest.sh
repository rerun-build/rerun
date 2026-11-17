#!/bin/sh
set -eu
fail() { echo "SELFTEST FAIL: $*" >&2; exit 1; }
here=$(dirname "$0")

[ "$(cat /proc/1/comm)" = tini ] || fail "PID 1 is not tini"
case "$(readlink /proc/1/fd/3)" in
    pipe:*) ;;
    *) fail "fd 3 held by tini is not a pipe: the design changes" ;;
esac
[ "$(tr '\0' '\n' </proc/1/environ | grep -c '^RERUN_API_KEY=')" = 0 ] || fail "tini environment has the key variable"
[ "$(tr '\0' '\n' </proc/self/environ | grep -c '^RERUN_API_KEY=')" = 0 ] || fail "child environment has the key variable"
[ "$(tr '\0' '\n' </proc/1/environ | grep -c '^RERUN_API_KEY_FILE=')" = 0 ] || fail "tini environment has the key file variable"
[ "$(tr '\0' '\n' </proc/self/environ | grep -c '^RERUN_API_KEY_FILE=')" = 0 ] || fail "child environment has the key file variable"
[ "${RERUN_KEY_FD:-}" = 3 ] || fail "RERUN_KEY_FD is not 3"

key=$(cat <&3)
exec 3<&-
[ "$key" = dummy ] || fail "key read from fd 3 is wrong"
[ "$(cat /proc/1/environ /proc/self/environ | tr '\0' '\n' | grep -c "=$key\$")" = 0 ] || fail "an environment holds the key value"
left=$(timeout 2 dd if=/proc/1/fd/3 iflag=nonblock 2>/dev/null | wc -c)
[ "$left" -eq 0 ] || fail "fd 3 of tini still holds $left byte(s)"
echo "selftest: pid1 tini, fd 3 pipe, key drained, key variable in no environment, key file variable in no environment"

[ ! -f "$here/entrypoint-selftest-signals.sh" ] || sh "$here/entrypoint-selftest-signals.sh"
