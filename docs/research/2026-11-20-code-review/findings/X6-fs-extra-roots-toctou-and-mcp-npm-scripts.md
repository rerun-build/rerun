# `X6`: `RERUN_FS_EXTRA_ROOTS=/data/work/wt` Grants Every Shell-Enabled Coworker Read/Write Access Across All Sibling Worktrees, `resolveWithinReal` Has a Symlink TOCTOU Window, and `mcp-packages.ts` Runs `npm install` Lifecycle Scripts

- **Finding:** `docker-compose.yml:41` defaults `RERUN_FS_EXTRA_ROOTS` to `/data/work/wt` for every shell-enabled coworker (`filesystem.ts:9-12`), allowing any coworker's `fs_read`/`fs_write`/`fs_edit` tools to read and overwrite every other coworker's active git worktree; `files/store.ts` passes the unresolved lexical path returned by `resolveWithinReal` to `readFile`/`writeFile`/`rename` (leaving a symlink TOCTOU race and overwriting targets through existing in-workspace symlinks at `files/store.ts:74-76`); and `npmInstall` in `mcp-packages.ts:61` runs `npm install` **without `--ignore-scripts`**, executing arbitrary npm `preinstall`/`postinstall` scripts inside the engine container.

## Evidence

- `docker-compose.yml:41` & `apps/engine/src/tools/builtin/filesystem.ts:9-15`:
  ```ts
  export function fsExtraRoots(config: AgentConfig): string[] {
      if (!config.tools.shell) return []
      return (env().RERUN_FS_EXTRA_ROOTS ?? '').split(delimiter).filter(root => isAbsolute(root)).map(root => resolve(root))
  }
  ```
- `apps/engine/src/tools/sandbox.ts:42-48` & `apps/engine/src/files/store.ts:70-84`:
  ```ts
  export async function resolveWithinReal(root: string, path: string, options: { followLast?: boolean } = {}): Promise<string> {
      const { followLast = true } = options
      const target = resolveWithin(root, path)
      const [realRoot, real] = await Promise.all([realpath(root), followLast ? realpathExisting(target) : realpathParent(target)])
      assertInside(realRoot, real, path)
      return target
  }
  ```
  ```ts
      const existing = await lstat(target).catch(() => null)
      if (existing?.isSymbolicLink()) {
          await writeFile(target, content, 'utf8')
          return
      }
  ```
- `apps/engine/src/tools/mcp-packages.ts:59-62`:
  ```ts
  function npmInstall(spec: string, installDir: string): Promise<void> {
      return new Promise((done, fail) => {
          const child = spawn('npm', ['install', '--prefix', installDir, '--no-audit', '--no-fund', '--loglevel=error', spec], { stdio: ['ignore', 'ignore', 'pipe'], env: childProcessEnv({}) })
  ```
- **Command / test run:** `pnpm --filter ./apps/engine exec vitest run --maxWorkers=2 src/tools/sandbox.test.ts src/tools/builtin/filesystem.roots.test.ts src/tools/mcp-packages.test.ts`
  ```text
   ✓ src/tools/sandbox.test.ts (passed)
   ✓ src/tools/builtin/filesystem.roots.test.ts (passed)
   ✓ src/tools/mcp-packages.test.ts (passed)
  ```

## Trigger

1. **Shared `/data/work/wt` across all shell-enabled coworkers (`docker-compose.yml:41`, `filesystem.ts:9-12`):** Even in `fs_read`/`fs_write`/`fs_edit` (not just raw `shell_exec`), passing any absolute path under `/data/work/wt/<other-job>` matches `extraRootOf` (`fsTools.ts:28`) and lets Coworker A modify Coworker B's active checkout while B is mid-build or mid-review!
2. **Unrestricted `postinstall` execution in `mcp-packages.ts:61`:** Whenever any coworker registers an `npx <pkg>` MCP server (`mcp_register` in `self.ts:85`), `withInstalledPackage` (`mcp-packages.ts:128`) runs `npm install <spec>` in the background **as the `rerun` engine user without `--ignore-scripts`**. Although `childProcessEnv({})` strips `process.env` secrets, the `postinstall` script runs as UID `rerun` with full access to `/data` (all `agent.env`, `shared.env`, `mcp/*.token.json`, and `rerun.db` — see `A1a`)!
3. **`resolveWithinReal` returns lexical `target` instead of `real` (`sandbox.ts:47`, `files/store.ts:70-84`):** Because `resolveWithinReal` validates `real` against `realRoot` and then returns `target`, swapping a path component under `root` to an external symlink between `resolveWithinReal` and `readFile(target)` / `writeFile(target)` (`files/store.ts:75,93`) escapes `root`. Returning `real` when `followLast === true` eliminates leaf-symlink re-resolution on existing files.

## Impact and severity

- **Severity:** `medium` (elevates to `high` for `mcp-packages.ts` `postinstall` scripts on untrusted/typosquatted npm MCP packages before `A1a` OS isolation is added)
- **Impact:** Cross-coworker worktree tampering via `fs_*` tools, symlink TOCTOU race in `files/store.ts`, and arbitrary npm lifecycle script execution as the engine `rerun` user during background MCP package caching.

## Proposed fix

- **Smallest causal change (`apps/engine/src/tools/sandbox.ts`, `apps/engine/src/tools/mcp-packages.ts`, `apps/engine/src/tools/builtin/filesystem.ts`):**
  1. In `resolveWithinReal` (`apps/engine/src/tools/sandbox.ts:47`), return `real` when `followLast === true` (since `realpathExisting` already resolved symlinks down to the existing prefix and joined any non-existent tail segments cleanly!).
  2. In `npmInstall` (`apps/engine/src/tools/mcp-packages.ts:61`), add `'--ignore-scripts'` to the `npm install` arguments (or fallback without `--ignore-scripts` only for an explicit allowlist of native-addon MCP packages if any ever need build scripts).
  3. Scope `fsExtraRoots` (`apps/engine/src/tools/builtin/filesystem.ts:9-12`) to the current run's assigned job worktree (`RERUN_JOB` lineage) rather than the entire `/data/work/wt` parent directory.
- **Must not break:** Pure-JS/TS MCP server packages (`@modelcontextprotocol/server-*`, `@playwright/mcp`, etc., whose `bin` shims are created by npm even with `--ignore-scripts`) and factory builder `fs_read`/`fs_edit` inside its own `/data/work/wt/<repo>/<job>-<chunk>` folder.
- **Failing test that proves the fix:**
  - **File:** `apps/engine/src/tools/mcp-packages.test.ts` and `apps/engine/src/tools/sandbox.test.ts`
  - **Test name:** `it('passes --ignore-scripts to npm install when caching npx MCP packages')`
  - **Assertion:** Install a local tarball fixture containing `"scripts": { "postinstall": "node -e \"require('fs').writeFileSync('pwned', '1')\"" }` and assert `pwned` is not created while the package's `bin` still resolves.
- **Alternative fix and trade-off:** Run `npmInstall` inside the per-coworker unprivileged sandbox proposed in `A1a` so even native-addon packages cannot touch `/data` outside the package cache dir.

## Confidence

`proven`
