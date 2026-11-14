#!/bin/sh
set -u
cd "$(dirname "$0")/../.."
[ "$(id -u)" = 0 ] || { echo "Run it with sudo: sudo sh deploy/vps/factory-m2-proof.sh"; exit 1; }

ENGINE="docker compose -f deploy/vps/dev-engine.yml"
STUB="docker compose -f deploy/vps/stub-model.yml"
RUNNER="docker compose -f deploy/vps/factory-runner.yml"
step() { printf '\n== %s\n' "$*"; }
try() { "$@" || echo "STEP FAILED (exit $?): $*"; }
runner() { try $RUNNER exec -T factory-runner python3 /app/runner_loop.py "$@"; }
status() { try sh deploy/vps/factory-status.sh; }
engine_up() {
    i=0
    while [ "$i" -lt 60 ]; do
        $ENGINE exec -T engine-dev curl -sf -o /dev/null -m 3 http://localhost:3000/health && return 0
        i=$((i + 1)); sleep 2
    done
    echo "STEP FAILED: the development engine did not answer /health within 120 s"
}

step "1/8 development engine key (kept if it exists)"
[ -e deploy/vps/.env ] || (umask 077; printf 'RERUN_DEV_ENGINE_KEY=%s\n' "$(openssl rand -hex 32)" > deploy/vps/.env)
[ -s deploy/vps/.env ] && echo "key file present" || echo "STEP FAILED: deploy/vps/.env is missing or empty"

step "2/8 start the development engine, the stub model and the runner"
try $ENGINE up -d
try $STUB up -d
try $RUNNER up -d
engine_up

step "3/8 set up the development engine (safe to repeat)"
runner setup

step "4/8 R1: fire one stage, wait 2 minutes"
runner enqueue r1 challenge
sleep 120
status

step "5/8 R2: a deliberately long run that the runner must cancel, wait 3 minutes"
runner enqueue r2 challenge-hold
sleep 180
status

step "6/8 R3: restart the development engine in the middle of a stage, wait 90 seconds"
runner enqueue r3 challenge-hold
sleep 20
try $ENGINE restart
sleep 90
status

step "7/8 R4: remove and start the runner in the middle of a job, wait 3 minutes"
runner enqueue r4 challenge-hold
sleep 20
try $RUNNER rm -sf factory-runner
try $RUNNER up -d
sleep 180

step "8/8 final status"
status
