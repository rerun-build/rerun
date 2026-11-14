#!/bin/sh
set -eu
SELF=$(cd "$(dirname "$0")" && pwd)/tidy.sh
UNITS=${TIDY_ROOT:-}/etc/systemd/system
BIN=${TIDY_ROOT:-}/usr/local/sbin/rerun-tidy

disk() { df -h / | tail -n 1; }

case "${1:-}" in
    report)
        disk
        docker system df
        ;;
    run)
        echo "before: $(disk)"
        docker image prune -f
        docker builder prune -af
        echo "after:  $(disk)"
        ;;
    install)
        install -m 755 "$SELF" "$BIN"
        printf '%s\n' '[Unit]' 'Description=Remove untagged images and unused build cache (deploy/vps/tidy.sh)' \
            '[Service]' 'Type=oneshot' "ExecStart=$BIN run" > "$UNITS/rerun-tidy.service"
        printf '%s\n' '[Unit]' 'Description=Weekly run of rerun-tidy' '[Timer]' 'OnCalendar=Sun 04:30' \
            'Persistent=true' '[Install]' 'WantedBy=timers.target' > "$UNITS/rerun-tidy.timer"
        systemctl daemon-reload
        systemctl enable --now rerun-tidy.timer
        systemctl list-timers rerun-tidy.timer --no-pager
        ;;
    uninstall)
        systemctl disable --now rerun-tidy.timer || true
        rm -f "$UNITS/rerun-tidy.service" "$UNITS/rerun-tidy.timer" "$BIN"
        systemctl daemon-reload
        echo "timer removed"
        ;;
    *)
        echo "Usage: sudo sh deploy/vps/tidy.sh report|run|install|uninstall"
        exit 2
        ;;
esac
