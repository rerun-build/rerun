# Shared variables: cutover runbook

Run this once, after the release that carries the shared-variable commands (#1284 S1 to S4) is live on the host. It moves the coworkers' GitHub and EverOS access from the key files into the engine, checks the result, and removes the key files only after the checks pass.

Every command runs from the repository folder on the host, one at a time, as:

    docker compose exec -T engine node dist/cli/bin.js <command>

Never run two `shared-env set` commands at once. Values are never printed and never written into this file or into a run record.

## Step 1, check

    docker compose exec -T engine node dist/cli/bin.js shared-env list

Expected output: `No shared variables.`. Anything else stops the runbook: find out what is already set before going on.

## Step 2, move the values

The values are read from the old key files and passed on stdin, so they never appear on the command line or on screen.

    docker compose exec -T engine sh -c 'node dist/cli/bin.js shared-env set GH_TOKEN < /data/tools/github/token'
    docker compose exec -T engine sh -c 'node dist/cli/bin.js shared-env set EVEROS_TOKEN < /data/tools/everos/token'
    docker compose exec -T engine sh -c 'sed -n "s/^export EVEROS_URL=\([^ ]*\).*/\1/p" /data/tools/bin/everos-mcp | node dist/cli/bin.js shared-env set EVEROS_URL'

Then set the plain values, one at a time. Each is passed with `printf` on stdin:

    printf '%s' 'default' | docker compose exec -T engine node dist/cli/bin.js shared-env set EVEROS_USER_ID
    printf '%s' 'rerun' | docker compose exec -T engine node dist/cli/bin.js shared-env set EVEROS_APP
    printf '%s' 'special-place-administrator' | docker compose exec -T engine node dist/cli/bin.js shared-env set GIT_AUTHOR_NAME
    printf '%s' 'special-place-administrator' | docker compose exec -T engine node dist/cli/bin.js shared-env set GIT_COMMITTER_NAME
    printf '%s' '<the email of the special-place-administrator GitHub account>' | docker compose exec -T engine node dist/cli/bin.js shared-env set GIT_AUTHOR_EMAIL
    printf '%s' '<the same email>' | docker compose exec -T engine node dist/cli/bin.js shared-env set GIT_COMMITTER_EMAIL
    printf '%s' '1' | docker compose exec -T engine node dist/cli/bin.js shared-env set GH_PROMPT_DISABLED
    printf '%s' '1' | docker compose exec -T engine node dist/cli/bin.js shared-env set GH_NO_UPDATE_NOTIFIER

The email is typed by the operator from that GitHub account's settings. It is not written in this repository.

After each `set`, run `shared-env list` and confirm the name is there. If a name is missing or a `set` printed an error, do not continue: the engine may have been killed mid-write or the disk may be full. Remove the partial name with `shared-env remove <NAME>` and set it again.

## Step 3, switch the coworkers' EverOS server

First count the coworkers that hold the old launcher:

    docker compose exec -T engine sh -c 'grep -l /data/tools/bin/everos-mcp /data/agents/*/config.json | wc -l'

Then replace the definition on every coworker that has it, with the definition in this repository:

    docker compose exec -T engine node dist/cli/bin.js mcp set-all everos < deploy/vps/everos-mcp.json

The number the command reports must equal the count from the first command. If it differs, stop: a coworker was added or removed in between, and the count must be checked again. Roll back by running `mcp set-all everos` again with the old definition `{"name":"everos","command":"/data/tools/bin/everos-mcp"}`.

## Step 4, move the old wrappers aside

    mkdir /data/tools/bin.pre-1284
    mv /data/tools/bin/gh /data/tools/bin/git /data/tools/bin/git-credential-ghtoken /data/tools/bin/everos-mcp /data/tools/bin.pre-1284/
    ln -s /data/tools/gh/bin/gh /data/tools/bin/gh
    ln -s /usr/bin/git /data/tools/bin/git

The two links keep the paths that `factory.py` and the briefs call. Rollback: remove the two links and move the four wrappers back from `bin.pre-1284`.

## Step 5, restart the engine

    docker compose restart engine

A coworker that is already running keeps the entry it started with. The restart is what makes every coworker take the new definition and the shared variables.

## Step 6, checks

Every check must pass before Step 7. Any failure stops the runbook and goes to the rollback of the step that was run last.

1. The GitHub token works through the engine, and it is the account of the operator:

        docker compose exec -T engine node dist/cli/bin.js shared-env run /data/tools/bin/gh api user --jq .login

   Expected output: `special-place-administrator`.

2. A private repository can be read with the shared token:

        docker compose exec -T engine node dist/cli/bin.js shared-env run /data/tools/bin/git ls-remote https://github.com/special-place-ai-heaven/testpilot HEAD

   Expected output: a commit sha on one line.

3. The EverOS server is up for a coworker. Use the id of any coworker that holds the definition:

        docker compose exec -T engine node dist/cli/bin.js mcp status <coworker id>

   Expected: `ok` for `everos`.

4. One coworker runs the GitHub check in its own shell. A variable the coworker has of its own would shadow the rotated shared value; this check shows that the shared value is the one in use:

        /data/tools/bin/gh api user --jq .login

   Expected output: `special-place-administrator`.

5. One coworker's `memory_search` answers. Ask it a plain question in its own session and read the reply.

## Step 7, remove the key files

Only when every check of Step 6 passed. This is the only place the runbook removes those paths:

    rm -rf /data/tools/github /data/tools/everos /data/tools/git /data/tools/gh/config /data/tools/bin.pre-1284

Until this step runs, the old wrappers stay in `bin.pre-1284`, so every earlier step can still be undone.

## Rollback to an older engine

If the engine is rolled back to a release that reads the key files, the files are gone and must be rebuilt from the shared values first:

    docker compose exec -T engine node dist/cli/bin.js shared-env run sh -c 'umask 077; mkdir -p /data/tools/github; printf %s "$GH_TOKEN" > /data/tools/github/token'
    docker compose exec -T engine node dist/cli/bin.js shared-env run sh -c 'umask 077; mkdir -p /data/tools/everos; printf %s "$EVEROS_TOKEN" > /data/tools/everos/token'

The release PR that carries this runbook copies this section into its Deploy notes.

## Rotation

Set the name again with `shared-env set <NAME>`, value on stdin. New processes read it straight away; no restart is needed.

- When GitHub rejects or revokes the token, `gh` and `git` print `401` or `Authentication failed` in the coworker's run. The repair is `printf '%s' '<new token>' | ... shared-env set GH_TOKEN`.
- When a value landed in a run record, redact the record with `rerun redact <agentId>`, value on stdin, then set a new token with `shared-env set`.

## How Rob runs gh by hand

    docker compose exec -T engine node dist/cli/bin.js shared-env run /data/tools/bin/gh <arguments>

The runbook prints no value and quotes no token.
