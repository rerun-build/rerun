# Canary of `checkout: clone`

The switch to `checkout: clone` for every builder happens only after this canary passed and the operator read its record. Builders stay at 1 for the canary job.

1. Install: the tools copy on the server is at or after the clone commits (`cat /data/tools/factory-installed`), and `wt mode` prints `checkout worktree`.
2. Mirror: `mirror refresh rerun`, then `mirror check rerun` prints `MIRROR rerun fresh`.
3. `wt new rerun <issue> <chunk> --clone` for one real job: the folder is a clone, `git remote get-url origin` is the GitHub URL, `.git/factory-ready` exists.
4. Build: the builder commits, runs its quick checks, and `pr-open` opens the pull request.
5. Fix round: one `pr-open --fix` after a red or a review, pushed.
6. Conflict: dev moves under the branch on a file it touches; `pr-open --fix` prints `CONFLICT:` and leaves no MERGE_HEAD; the builder merges by hand and pushes.
7. Merge: `merge-dev` merges, the folder stays; a second `merge-dev` prints `MERGED earlier as`.
8. Janitor: after an hour, `wt janitor --apply` moves the folder to the trash and `wt restore <entry>` brings it back once; the next pass moves it again.
9. Load: time and peak memory of 1, 4 and 8 `wt new --clone` at once (`/usr/bin/time -v`), written into the parent issue with the size of one clone with and without node_modules, before builders go above 8.
10. Record: the operator posts the record of steps 1 to 9 on the parent issue and only then runs `wt mode clone --canary <url of that comment>`. The first five clone jobs after that are watched: one tool fault among them switches back to `checkout worktree` by itself.
