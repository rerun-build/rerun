#!/usr/bin/env bash
# Puts the private repository of Rerun Cloud in cloud/ when this checkout has access to it. Without it
# the workspace runs the open source build, which is what a contributor gets, so this never fails the
# setup: it says so instead.
#
# A local workspace clones the copy of the main checkout ($CONDUCTOR_ROOT_PATH/cloud): no network and
# no credentials, which a setup shell does not always find. A cloud workspace, or a main checkout
# without cloud/, clones from GitHub next to origin.
set -u
export GIT_TERMINAL_PROMPT=0

[ -d cloud/.git ] && exit 0

github_url=$(git remote get-url origin | sed -E 's#/rerun(\.git)?$#/rerun-cloud.git#')
main_copy="${CONDUCTOR_ROOT_PATH:-}/cloud"

if [ -n "${CONDUCTOR_ROOT_PATH:-}" ] && [ -d "$main_copy/.git" ] && [ "$(cd "$main_copy/.." && pwd -P)" != "$(pwd -P)" ]; then
  if git clone -q "$main_copy" cloud; then
    git -C cloud remote set-url origin "$(git -C "$main_copy" remote get-url origin)"
    # The main copy may be behind GitHub or on another branch: start from the latest dev when it is reachable.
    if git -C cloud fetch -q origin dev 2>/dev/null; then
      git -C cloud checkout -q -B dev FETCH_HEAD
    fi
    echo "cloud/: cloned from $main_copy, on $(git -C cloud rev-parse --abbrev-ref HEAD) @ $(git -C cloud rev-parse --short HEAD)"
    exit 0
  fi
fi

if git clone -q -b dev "$github_url" cloud; then
  echo "cloud/: cloned from $github_url"
  exit 0
fi

echo "WARNING: cloud/ could not be cloned ($github_url): this workspace runs the open source build, without Rerun Cloud." >&2
echo "         Clone it by hand, then run pnpm install: git clone -b dev $github_url cloud" >&2
exit 0
