# Moving the monorepo from pnpm 8.15.4 to pnpm 12.18.0

as_of 2026-11-14. Status: plan only. I did not install, upgrade or run pnpm 9/12 for this; every
claim carries a tag:

- **[repo]** read in this checkout (file:line).
- **[notes]** read in a pnpm release note or pnpm doc (URL given).
- **[run]** not executed yet; the step that settles it is named.

Provenance: crawl4ai answered "Could not find session" on every call, so release notes came from the
GitHub API (`gh api repos/pnpm/pnpm/releases/tags/<tag>`) and the pnpm.io pages from their source,
`pnpm/pnpm.io` `docs/` on `main` (its `docs-sync.json` says that tree tracks pnpm 12.21.0, three
minors past 12.18.0). The 12.x patch-level entries come from `CHANGELOG.md` inside the
`pnpm-12.18.0.tgz` tarball and the matching GitHub release pages. npm today: `latest` = 12.18.0,
`next-12` = 12.21.0. Every pnpm.io URL cited below was checked to resolve (HTTP 200; a made-up path
returns 404). I worked from raw reads and `gh`/`npm view`, not SymForge or Terminal Commander.

## Verdict

Migrate, in one pull request, with a **two-hop lockfile conversion** (pnpm 9.15.9 first, then pnpm 12):
pnpm 10 removed the v6-to-v9 lockfile conversion and says to use pnpm 9 for it
([v10.0.0](https://github.com/pnpm/pnpm/releases/tag/v10.0.0)), and pnpm 11+ fails a frozen install
on an incompatible lockfile ([v11.0.0](https://github.com/pnpm/pnpm/releases/tag/v11.0.0), #10978).
What pnpm 12 does *non-frozen* with a v6 file I did not establish **[run]**; do not rely on it.

Eight repo edits, one per-machine change, two owner decisions. Confidence: **medium**. It becomes
high once steps 1-5 below pass in CI and the two Docker images build and run.

## Decisions only the owner can make (the plan assumes the answer in brackets)

1. **Upstream syncs.** `upstream` = `rerun-build/rerun`, still `packageManager: pnpm@8.15.4` with
   lockfile version 6.0 on `dev` **[repo, gh api]**. It was last merged in on 2026-11-13
   (`4a73fb2`). After this migration every sync conflicts on `pnpm-lock.yaml`. Also, any override
   upstream adds to `package.json#pnpm` is ignored by pnpm 12 with only a warning
   ([configuring](https://pnpm.io/configuring): "A setting found there is ignored with a warning").
   *Assumed: migrate anyway. Resolve sync conflicts by keeping ours, porting upstream's
   `package.json#pnpm` changes into `pnpm-workspace.yaml`, and re-running `pnpm install`. Step 6
   adds a CI guard.* Whether to upstream the change too is the owner's call.
2. **The private `cloud/` workspace.** `scripts/install-cloud.mjs:63` runs
   `pnpm install --frozen-lockfile` in `cloud/` from the root `postinstall` **[repo]**. `cloud/` is
   not in this checkout, so I could not read its lockfile or pin. *Assumed: it has its own
   `packageManager`/lockfile and gets the same two hops in lockstep. Until it does, a pnpm 12 root
   install runs a frozen install there against a v6 lockfile, and that fails.*

Smaller owner facts: does the self-hosted CI pool `aap-crrr` run Node-24 JavaScript actions
(`pnpm/action-setup` v5+ moved to Node 24, [v5.0.0](https://github.com/pnpm/action-setup/releases/tag/v5.0.0))?
And can EAS Build run pnpm 12 (step 7)?

## What the repo has (checked)

| Item | Finding |
|---|---|
| `package.json:7` | `"packageManager": "pnpm@8.15.4"` **[repo]** |
| `package.json:8-10` | `engines.node >=26.13` **[repo]** |
| `package.json:48-84` | `pnpm.patchedDependencies` (1 entry, `ai-sdk-provider-codex-cli@1.6.0`, patches `dist/index.cjs` and `dist/index.js`) and `pnpm.overrides` (29 entries) **[repo]** |
| `package.json:12` | root `postinstall` runs `scripts/install-cloud.mjs` and `scripts/install-git-hooks.mjs` **[repo]** |
| `pnpm-workspace.yaml` | `packages: apps/*, packages/*`, nothing else **[repo]** |
| `.npmrc` | **untracked** (`.git/info/exclude:8`). Holds 4 network keys (`network-concurrency`, `fetch-retries`, `fetch-retry-mintimeout`, `fetch-retry-maxtimeout`) and a comment saying Docker builds read it through `COPY . .`. No auth lines **[repo]** |
| `pnpm-lock.yaml` | lockfile version 6.0, settings `autoInstallPeers: true`, `excludeLinksFromLockfile: false`, 11 importers. No git or tarball resolutions **[repo]** |
| `.gitattributes` | `*.yaml text eol=lf`, `Dockerfile* text eol=lf` **[repo]** |
| `.github/workflows/ci.yml:26-31` | `pnpm/action-setup@v4` (no `version`, so it reads `packageManager`), `actions/setup-node@v4` with `node-version: 26`, `cache: pnpm`, then `pnpm install --frozen-lockfile` **[repo]** |
| `.github/workflows/ci.yml:86` | a PR that touches `package.json`, `pnpm-lock.yaml` or `pnpm-workspace.yaml` also builds both images **[repo]** |
| `apps/ui/Dockerfile:3-5,27-28` | `node:26-bookworm-slim`, `npm install -g corepack && corepack enable`, `pnpm install --frozen-lockfile --store-dir /pnpm-store --filter rerun... --filter @moldwright/contracts`. Runtime runs `node .../next start`, not pnpm **[repo]** |
| `apps/engine/Dockerfile:5-15` | `node:26-trixie-slim`, the same corepack line, `--filter rerun-engine...`, then `pnpm --filter rerun-engine deploy --prod /out`. Runtime runs `node dist/cli/bin.js` **[repo]** |
| `apps/engine/package.json:8-12` | `files: [dist, assets, patches]`; depends on `@moldwright/contracts: workspace:*` **[repo]** |
| Other pnpm callers | `apps/engine/src/cli/commands/update.ts:240` (`pnpm --filter rerun-engine... install --prod=false --frozen-lockfile` on git-checkout boxes), `tools/factory/factory.py:539` (`pnpm install --frozen-lockfile --prefer-offline`, 300 s timeout, fresh worktrees), `apps/mobile/eas.json:8` (`"pnpm": "8.15.4"` for EAS Build), `scripts/dev-mobile.mjs:135` (parses stdout of `pnpm --dir ... exec expo config --json`) **[repo]** |
| Workspace protocol | every internal dependency uses `workspace:*` **[repo]** |
| `npm_config_*` in repo | none **[repo]** |

**Packages with install scripts.** I read `hasInstallScript` from npm's install metadata for all 2,111
package names in the lockfile, 0 failures. Exactly 10 locked versions have one: `esbuild@0.27.4`,
`esbuild@0.28.2`, `@posthog/cli@0.19.3`, `@swc/core@1.16.22`, `@parcel/watcher@2.6.0`,
`core-js@3.51.0`, `ssh2@1.17.0`, `cpu-features@0.0.10`, `electron-winstaller@5.4.0`, `fsevents@2.3.3`
**[repo + registry]**. The lockfile's 270 `requiresBuild: true` flags over-report, because pnpm 8 sets
the flag on optional platform packages it never fetched. These were named as candidates and have **no**
install script: `sharp@0.35.5` (prebuilt `@img/*`), `electron@45.3.1` (its binary comes from an
`install-electron` bin, not a postinstall), `supabase@2.122.1`, `@openai/codex`,
`@anthropic-ai/claude-agent-sdk`. `better-sqlite3` is not in the lockfile. The local `node_modules` is
stale (it holds `msw` and `unrs-resolver@1.12.2`, neither of which is locked), so the registry list is
the one to use. The scan script is `hasscript.mjs` (step 3); it reads npm's install metadata for each
locked name and prints the versions with `hasInstallScript`.

**Doc/code gaps:**
- `CONTRIBUTING.md:8` and `apps/docs/self-host/contributing.mdx:10` say "Node 22, pnpm 8
  (`corepack enable`)". The code needs Node >=26.13 (`package.json:9`) **[repo]**.
- The `.npmrc` comment ("Docker builds read this") becomes false under pnpm 11+, which reads only
  auth and registry keys from `.npmrc` ([v11.0.0](https://github.com/pnpm/pnpm/releases/tag/v11.0.0)) **[notes]**.

## 1. Breaking changes 8.15 -> 12.x that touch this repo, and the edit each needs

### 1a. Lockfile

- v9 adopts lockfile v9 ([v9.0.0](https://github.com/pnpm/pnpm/releases/tag/v9.0.0)). v10 removes
  the v6-to-v9 conversion ("use pnpm CLI v9", [v10.0.0](https://github.com/pnpm/pnpm/releases/tag/v10.0.0)).
  pnpm 12 still writes lockfile version 9.0 by default (`lockfile.format` default `v9`,
  [settings/store](https://pnpm.io/settings/store#lockfileformat)) **[notes]**.
- The patch hash becomes SHA256 ([v10.0.0](https://github.com/pnpm/pnpm/releases/tag/v10.0.0)), and
  the `patchedDependencies` lockfile section becomes `selector: hash`, migrated automatically
  ([v11.0.0](https://github.com/pnpm/pnpm/releases/tag/v11.0.0) #10911) **[notes]**. So the pnpm 12
  hop must be a **non-frozen** install that rewrites the lockfile once.
- pnpm 12: frozen installs read an existing v9 lockfile unchanged. The first re-resolving install
  may re-key peer variants of packages in dependency cycles once
  ([v12.0.0](https://github.com/pnpm/pnpm/releases/tag/v12.0.0)) **[notes]**.
- A lockfile can become two YAML documents (a "boot document" for config dependencies and the pinned
  pnpm) ([lockfile](https://pnpm.io/lockfile)) **[notes]**. Nothing in this repo parses the lockfile:
  `tools/factory/factory.py:535` only checks that it exists **[repo]**.
- **Does `--frozen-lockfile` pass after one regeneration?** It should: pnpm 9 converts and keeps the
  versions, pnpm 12 rewrites once, and from then on frozen installs reuse it. **[run]**: step 4 proves
  it with two frozen installs in a clean clone and `git status --porcelain`.

### 1b. Where settings live (pnpm 11+)

pnpm 11 stops reading `package.json#pnpm` and reads only auth/registry keys from `.npmrc`. All other
settings go in `pnpm-workspace.yaml` (project) or the global `config.yaml` (machine)
([v11.0.0](https://github.com/pnpm/pnpm/releases/tag/v11.0.0) #10086, #11189;
[configuring](https://pnpm.io/configuring)). pnpm 12 fails a command when `pnpm-workspace.yaml` holds
a key it does not recognize and the project pins a pnpm version it satisfies
(`ERR_PNPM_UNRECOGNIZED_WORKSPACE_SETTINGS`, [v12.0.0](https://github.com/pnpm/pnpm/releases/tag/v12.0.0))
**[notes]**. That is good here: a misspelled key fails loudly.

If the `pnpm` block stayed in `package.json`, a frozen install would no longer match the lockfile's
`overrides`, and a non-frozen one would drop all 29 overrides and the patch. Most overrides are
version floors for security fixes **[repo: values]**; dropping them is the worst silent outcome here.

Do **not** use the `pnpm-v10-to-v11` codemod ([migration](https://pnpm.io/migration)): it moves
`.npmrc` settings into `pnpm-workspace.yaml` **[notes]**. That would commit this machine's untracked
network settings into the shared file. The edit is small enough to do by hand.

### 1c. Build scripts of dependencies

- pnpm 10 stops running dependency lifecycle scripts by default and uses an `onlyBuiltDependencies`
  allow-list ([v10.0.0](https://github.com/pnpm/pnpm/releases/tag/v10.0.0)).
- pnpm 11 removes `onlyBuiltDependencies`, `neverBuiltDependencies`, `ignoredBuiltDependencies`,
  `onlyBuiltDependenciesFile` and `ignoreDepScripts` in favour of an `allowBuilds` map. It also sets
  `strictDepBuilds: true` by default ([v11.0.0](https://github.com/pnpm/pnpm/releases/tag/v11.0.0) #11220).
- Under pnpm 11/12 an unlisted package with a build script **fails the install**
  (`ERR_PNPM_IGNORED_BUILDS`, [settings/build](https://pnpm.io/settings/build#allowbuilds)), and the
  install writes a placeholder entry for it into `pnpm-workspace.yaml`
  ([v11.0.0](https://github.com/pnpm/pnpm/releases/tag/v11.0.0) #11030) **[notes]**.

So on 12 nothing breaks silently from a *missing* entry. Only a deliberate `false` changes behaviour
quietly. (On pnpm 10, a missing entry would have been a silent skip with a warning.) The project's own
root `postinstall` is not a dependency script and is not gated **[notes: allowBuilds covers the
packages in the dependencies]**.

| Package | Script (read from the package) | Pulled in by **[repo, lockfile]** | Set | What `false` costs |
|---|---|---|---|---|
| `esbuild` | `postinstall: node install.js` | `tsx`, `react-email`, `@react-email/*` (dev, 5 importers) | `true` | keeps pnpm 8 behaviour; no reason to change |
| `@posthog/cli` | `postinstall: node ./install.js` (downloads the CLI binary) | `@posthog/nextjs-config` (apps/ui; sourcemap upload in `apps/ui/next.config.*:54-62`) | `true` | little: `run-posthog-cli.js` -> `binary.js run()` installs the binary on first run if it is missing **[repo]**, so `false` only moves the download into `next build` |
| `fsevents` | install script (registry flag) | file watchers; macOS only | `true` | file watching on macOS dev (`pnpm dev:mobile` on the Mac) |
| `@swc/core` | `postinstall`: checks the native binding, installs `@swc/wasm` as a fallback if it is missing | `next-intl` (apps/ui) | `false` | nothing on a platform with a prebuilt binding (the binding comes through its optional platform package) |
| `@parcel/watcher` | `install: node scripts/build-from-source.js`, which builds only when `npm_config_build_from_source=true` **[repo]** | `jest-haste-map`, `next-intl` | `false` | nothing (it is a no-op today, and pnpm 11 no longer sets `npm_config_*` for scripts, [v11.0.0](https://github.com/pnpm/pnpm/releases/tag/v11.0.0) #11116) |
| `core-js` | `postinstall`: prints a banner | `posthog-js` | `false` | nothing |
| `ssh2` | `install`: node-gyp build of an *optional* crypto binding, always exits 0 **[repo]** | apps/ui (direct, `apps/ui/package.json:90`) | `false` | the optional native crypto binding. It is built on this Windows box (`lib/protocol/crypto/build/` exists) **[repo]**. The slim Docker images most likely never had it, since they carry no compiler **[run: look for "Failed to build optional crypto binding" in the current UI image build log]**. Set `true` if SSH throughput on dev matters |
| `cpu-features` | `install: node buildcheck.js > buildcheck.gypi && node-gyp rebuild` | optional dependency of `ssh2` | `false` (same as `ssh2`) | CPU feature detection that `ssh2` uses for cipher order |
| `electron-winstaller` | `install`: copies the host-arch `7z` into `vendor/` | `electron-builder-squirrel-windows` (desktop dev) | `false` | only the Squirrel target uses it. The desktop config builds `nsis` (`apps/desktop-app/electron-builder.config.ts:94`) **[repo]** |

Re-run the registry scan after step 3. Re-resolution can change versions, and a new entry fails the
install anyway.

### 1d. The edits (file, old, new)

**E1 `package.json`**

- old: `"packageManager": "pnpm@8.15.4",`
- new: `"packageManager": "pnpm@12.18.0",`
- Remove the whole `"pnpm": { "patchedDependencies": {...}, "overrides": {...} }` block (lines 48-84)
  and move it to E2.
- Why: pnpm 12 manages its own version from this field (`pmOnFail: download` is the default). Left at
  8.15.4, pnpm 12 downloads and runs pnpm 8.15.4 ([v10.0.0](https://github.com/pnpm/pnpm/releases/tag/v10.0.0)
  `manage-package-manager-versions`; [v11.0.0](https://github.com/pnpm/pnpm/releases/tag/v11.0.0)
  `pmOnFail`; [migration-v11](https://pnpm.io/migration-v11) step 2).

**E2 `pnpm-workspace.yaml`** (new content; keys checked against the 12.x settings pages)

```yaml
packages:
    - 'apps/*'
    - 'packages/*'

overrides:
    'next': '16.4.6'
    'dompurify': '^3.4.17'
    'shell-quote': '^1.12.0'
    'proxy-addr': '^2.0.8'
    'axios': '^1.21.1'
    'fast-uri': '^3.1.9'
    'follow-redirects': '^1.16.3'
    'undici@6': '^6.29.1'
    'sharp': '^0.35.5'
    'body-parser': '^2.4.0'
    'ip-address': '^10.7.6'
    'markdown-it': '^14.3.3'
    'systeminformation': '^5.33.19'
    'engine.io': '^6.6.11'
    'node-forge': '^1.4.3'
    'nanoid@3': '^3.3.20'
    'ws@8': '^8.22.2'
    'js-yaml@3': '^3.15.2'
    'js-yaml@4': '^4.3.2'
    'brace-expansion@1': '^1.1.21'
    'brace-expansion@5': '^5.0.12'
    'socket.io-parser': '^4.2.7'
    'postcss': '^8.5.32'
    'source-map-js': '^1.2.2'
    'browserslist': '^4.29.5'
    'basic-ftp': '^6.2.6'
    'deepmerge-ts': '^8.0.2'
    'vite': '^8.3.8'
    '@anthropic-ai/claude-agent-sdk': '0.3.322'

patchedDependencies:
    'ai-sdk-provider-codex-cli@1.6.0': 'apps/engine/patches/ai-sdk-provider-codex-cli@1.6.0.patch'

# Dependencies whose install scripts may run. Every package with one must be listed, or the
# install fails (strictDepBuilds). See docs/research/2026-11-14-pnpm-12/PLAN.md, section 1c.
allowBuilds:
    'esbuild': true
    '@posthog/cli': true
    'fsevents': true
    '@swc/core': false
    '@parcel/watcher': false
    'core-js': false
    'ssh2': false
    'cpu-features': false
    'electron-winstaller': false

# pnpm 8 never installed before `pnpm run`/`exec`. Off until it is shown that its output stays off
# the stdout that scripts parse (scripts/dev-mobile.mjs:135).
verifyDepsBeforeRun: false

# Drop stale minimumReleaseAge exclusions when the lockfile no longer needs them.
minimumReleaseAgeExcludePrune: true
```

Sources: [overrides](https://pnpm.io/settings/dependency-resolution#overrides),
[patchedDependencies](https://pnpm.io/cli/patch#patcheddependencies),
[allowBuilds](https://pnpm.io/settings/build#allowbuilds),
[verifyDepsBeforeRun](https://pnpm.io/settings/build) (default `install` since
[v11.0.0](https://github.com/pnpm/pnpm/releases/tag/v11.0.0) #11158),
[minimumReleaseAgeExcludePrune](https://pnpm.io/settings/dependency-resolution#minimumreleaseageexcludeprune).
Keys starting with `@` must be quoted in YAML; quoting every key keeps it uniform.

**E3 `apps/mobile/package.json` devDependencies**

- add: `"eslint": "^9.39.5",`
- Why: `apps/mobile/eslint.config.js` does `require('eslint/config')`, but `apps/mobile` does not
  declare `eslint`. The lockfile importer `apps/mobile` has no `eslint` either. Today it resolves
  through root `node_modules/eslint`, which exists only because pnpm 8 publicly hoisted `*eslint*`
  (the root `package.json` does not declare it) **[repo]**. pnpm 10 sets `public-hoist-pattern` to
  nothing ([v10.0.0](https://github.com/pnpm/pnpm/releases/tag/v10.0.0) #8378), so `expo lint`
  breaks, and CI's `pnpm -r --if-present lint` includes it.
- 9.39.5 is the version already locked for `eslint-config-expo@58.0.4_eslint@9.39.5`, so no new
  version enters.
- The other lint configs import only what their package declares **[repo]**. That check covered
  imports in the config files, not plugins or resolvers that ESLint loads by name, and root
  `node_modules` also holds hoisted `eslint-import-resolver-*`. The lint run in step 4 is the proof.
  If it fails on a missing plugin, the fallback is `publicHoistPattern: ['*eslint*', '*prettier*']`
  in `pnpm-workspace.yaml` (the pnpm 8 default).

**E4 `.github/workflows/ci.yml:26`**

- old: `- uses: pnpm/action-setup@v4`
- new: `- uses: pnpm/action-setup@v6`
- Why: pnpm 12 support arrived in v6.1.0 ([v6.1.0](https://github.com/pnpm/action-setup/releases/tag/v6.1.0)),
  and v6.1.1 is current (2026-11-03). v4 predates pnpm 11 support
  ([v6.0.0](https://github.com/pnpm/action-setup/releases/tag/v6.0.0)).
- `setup-node` `cache: pnpm` stays **[run: the CI job]**.

**E5 `apps/ui/Dockerfile:5` and `apps/engine/Dockerfile:7`**

- old: `RUN npm install -g corepack && corepack enable`
- new: `RUN npm install -g corepack@0.36.0 && corepack enable`
- Keep `ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0`.
- Why keep corepack at all: both runtime stages are `FROM base` (`apps/ui/Dockerfile:32`,
  `apps/engine/Dockerfile:17`) **[repo]**, so corepack's `pnpm`/`yarn` shims ship in the running
  images. The engine forwards `COREPACK_ENABLE_DOWNLOAD_PROMPT` to every process it starts for an
  agent (`apps/engine/src/lib/child-env.ts:5`) **[repo]**, which says agent shells are expected to
  use corepack-managed tools there. Removing corepack from `base` would take those shims away from
  coworkers. Leave it, and pin it.
- Why the pin: today's unpinned `npm install -g corepack` gets whatever is latest.
  - corepack 0.34.5 fixed the pnpm 11 bin path ([corepack CHANGELOG](https://github.com/nodejs/corepack/blob/main/CHANGELOG.md) #776).
  - corepack 0.36.0 maps pnpm `>=11.0.0` to `./bin/pnpm.mjs` (read in the 0.36.0 tarball).
  - The pnpm 12.18.0 tarball ships `bin/pnpm.mjs`, which downloads the native binary on first use,
    because corepack installs no optional dependencies and runs no scripts (read in the tarball;
    [v12.0.0-rc.6](https://github.com/pnpm/pnpm/releases/tag/v12.0.0-rc.6) #13018).
- Cost: that download happens in every uncached build stage, and each pnpm call starts Node twice
  before the native binary runs **[run: step 5]**.
- Alternative if the build is slow and the shims are not needed at run time: install pnpm only in
  the build stage, with `RUN npm install -g pnpm@12.18.0`. The npm package needs Node 18+ and its
  install script puts the native binary in place ([installation](https://pnpm.io/installation)).
  Another way is `COPY --from=ghcr.io/pnpm/pnpm:12 /opt/pnpm /opt/pnpm` plus symlinks
  ([docker](https://pnpm.io/docker)). Either way, keep the version equal to `packageManager`, or
  pnpm downloads the pinned one.
- `pnpm install --frozen-lockfile --store-dir /pnpm-store --filter ...` and
  `pnpm --filter rerun-engine deploy --prod /out` need no edit:
  - pnpm 10 made `deploy` require `inject-workspace-packages=true`
    ([v10.0.0](https://github.com/pnpm/pnpm/releases/tag/v10.0.0)). 12.2.0 lifted that
    ([deploy](https://pnpm.io/cli/deploy); [v12.2.0](https://github.com/pnpm/pnpm/releases/tag/v12.2.0)).
  - The new deploy writes a dedicated lockfile. It can fail with `ERR_PNPM_DEPLOY_AMBIGUOUS_PEER`
    when ancestors provide more than one version of a peer of a linked workspace package. The fix is
    an `overrides` pin or `injectWorkspacePackages: true`. `--legacy` still selects the old path, and
    since 12.16.0 it also checks `minimumReleaseAge` ([deploy](https://pnpm.io/cli/deploy)). **[run]**
  - The deploy copies the `pnpm pack` file set, which is `files: [dist, assets, patches]` for the
    engine **[repo]**. Check that `/out` holds `dist/` and the patched dependency (step 5).

**E6 `apps/mobile/eas.json:8`**

- old: `"pnpm": "8.15.4"`
- new: `"pnpm": "12.18.0"`
- **[run]**: whether EAS Build can install pnpm 12 is not established. Run one development build.

**E7 `CONTRIBUTING.md:8` and `apps/docs/self-host/contributing.mdx:10`**

- old: ``You need Node 22, pnpm 8 (`corepack enable`)``
- new: ``You need Node 26 and pnpm 12 (`npm install -g pnpm@12.18.0`)``. Add corepack back to this
  line only once step 5 has shown corepack running pnpm 12.
- This also fixes the existing Node gap.

**E8 `pnpm-lock.yaml`** is regenerated by steps 1-3. Do not edit it by hand.

**No edit needed** **[repo + notes]**:

- `update.ts:240` uses `--prod=false` with `=`. pnpm 12 rejects only the separate-value form
  (`--frozen-lockfile false`) ([migration-v11](https://pnpm.io/migration-v11);
  [v12.0.0](https://github.com/pnpm/pnpm/releases/tag/v12.0.0) #14741).
- No script is named `clean`, `deploy`, `setup` or `rebuild` at a root where it would shadow a
  built-in. `@moldwright/contracts` has a `clean` script, but pnpm 8 ran that script too
  ([v11.0.0](https://github.com/pnpm/pnpm/releases/tag/v11.0.0) #11118).
- No custom `pre*`/`post*` scripts exist, so `enable-pre-post-scripts` (on since
  [v9.0.0](https://github.com/pnpm/pnpm/releases/tag/v9.0.0)) changes nothing.

### 1e. Default changes, one line each

| Default | Since | Effect here |
|---|---|---|
| `link-workspace-packages` off | [v9](https://github.com/pnpm/pnpm/releases/tag/v9.0.0) | none: every internal dependency uses `workspace:*` **[repo]** |
| `hoist-workspace-packages` on, `dedupe-injected-deps` on | [v9](https://github.com/pnpm/pnpm/releases/tag/v9.0.0) | none expected |
| `dedupe-peer-dependents` on | [v8.0.0](https://github.com/pnpm/pnpm/releases/tag/v8.0.0); still `true` in [12.x](https://pnpm.io/settings/peer-dependencies) | no change from 8.15 |
| `resolution-mode` `highest` | [v8.7.0](https://github.com/pnpm/pnpm/releases/tag/v8.7.0); still `highest` in [12.x](https://pnpm.io/settings/other) | no change from 8.15 |
| peer resolution fixes, optional peers from anywhere in the graph | [v9](https://github.com/pnpm/pnpm/releases/tag/v9.0.0) | can change peer variants during hop 1; the version-set check catches real version changes |
| `public-hoist-pattern` empty | [v10](https://github.com/pnpm/pnpm/releases/tag/v10.0.0) | breaks mobile lint, fixed by E3 |
| all dependencies installed even with `NODE_ENV=production` | [v10](https://github.com/pnpm/pnpm/releases/tag/v10.0.0) | none: build stages do not set `NODE_ENV` **[repo]** |
| `virtual-store-dir-max-length` 60 on Windows | [v10](https://github.com/pnpm/pnpm/releases/tag/v10.0.0) | Windows dev only; cosmetic |
| store v10, then v11 (SQLite index) | [v10](https://github.com/pnpm/pnpm/releases/tag/v10.0.0), [v11](https://github.com/pnpm/pnpm/releases/tag/v11.0.0) | a new store; the old `E:\.pnpm-store\v3` and the BuildKit cache `rerun-pnpm-store` keep v3 data, which can be removed later |
| `optimisticRepeatInstall` on | [v11](https://github.com/pnpm/pnpm/releases/tag/v11.0.0) | a no-op re-install **skips the root `postinstall`**, so git hooks and the `cloud/` install do not re-run ([settings/other](https://pnpm.io/settings/other#optimisticrepeatinstall)); run the scripts by hand when needed |
| `verifyDepsBeforeRun: install` | [v11](https://github.com/pnpm/pnpm/releases/tag/v11.0.0) | can start installs inside `pnpm run`/`exec` (factory worktrees, `dev-mobile`); E2 sets it `false` |
| `minimumReleaseAge: 1440` (non-strict when not set), `blockExoticSubdeps: true` | [v11](https://github.com/pnpm/pnpm/releases/tag/v11.0.0) | no exotic sources in the lockfile **[repo]**; for release age see risk R3 |
| scripts print `$ command` to stderr | [v11](https://github.com/pnpm/pnpm/releases/tag/v11.0.0) #11132 | keeps stdout clean for `dev-mobile.mjs:135` |
| Node.js 22+ for pnpm 11; pnpm 12 native, npm package needs Node 18+ | [v11](https://github.com/pnpm/pnpm/releases/tag/v11.0.0), [installation](https://pnpm.io/installation) | Node 26 everywhere **[repo]** |
| `packageImportMethod: auto` hard-links first on Linux | [v12](https://github.com/pnpm/pnpm/releases/tag/v12.0.0) | ext4 unchanged |
| filtered install refuses a `node_modules` made with another store or layout; `add`/`update` fail with `ERR_PNPM_MODULES_BREAKING_CHANGE` on an old `node_modules` | [v12.16.0](https://github.com/pnpm/pnpm/releases/tag/v12.16.0) | every existing checkout needs one **unfiltered** `pnpm install` first, including the boxes that run `update.ts:240` |

## 2. Improvements worth adopting (one line each)

In the migration PR:

1. `allowBuilds` map: only reviewed packages run scripts, and a new script-bearing dependency fails CI
   instead of running ([v11](https://github.com/pnpm/pnpm/releases/tag/v11.0.0)).
2. `minimumReleaseAge` default plus `minimumReleaseAgeExcludePrune`: a one-day wait on new versions
   blocks most hijacked releases ([supply-chain-security](https://pnpm.io/supply-chain-security)).
3. The native pnpm 12 binary: faster installs, and with the build-stage alternative in E5 no Node
   start-up per pnpm call ([v11](https://github.com/pnpm/pnpm/releases/tag/v11.0.0) performance
   section, [v12](https://github.com/pnpm/pnpm/releases/tag/v12.0.0)).

Follow-up PRs:

4. `pnpm audit --fix=update`: fixes advisories by moving lockfile versions instead of adding
   overrides. Most of the 29 overrides here are security floors that could then go
   ([v11](https://github.com/pnpm/pnpm/releases/tag/v11.0.0)).
5. Canonical cycle breaking: byte-identical lockfiles from repeated installs mean fewer spurious
   conflicts on upstream syncs ([v12](https://github.com/pnpm/pnpm/releases/tag/v12.0.0)). This comes
   free with the upgrade.
6. `SOURCE_DATE_EPOCH` with `pnpm deploy` (12.15.0+): `/out` comes out identical, so the engine image
   layer stays cached ([deploy](https://pnpm.io/cli/deploy#reproducible-output)).
7. `catalog:`: `zod ^4.6.7`, `typescript ^5.9.3`, `eslint ^9.39.5` repeat across packages; a catalog
   keeps each version in one place ([overrides/catalogs](https://pnpm.io/settings/dependency-resolution#overrides)).
8. `pnpm peers check`: a peer audit from the lockfile, now that install no longer prints the tree
   ([v11](https://github.com/pnpm/pnpm/releases/tag/v11.0.0)).
9. `pnpm sbom`: CycloneDX/SPDX for the two images ([v11](https://github.com/pnpm/pnpm/releases/tag/v11.0.0)).
10. `trustPolicy: no-downgrade`: fails an install when a package's publish trust drops
    ([settings](https://pnpm.io/settings/dependency-resolution#trustpolicy)). Try it once the
    migration is stable.

Not now:

- `dedupePeers`: rewrites many peer keys. The lockfile already has two `claude-agent-sdk` variants,
  for `@anthropic-ai/sdk` 1.7.0 and 1.8.0.
- The global virtual store.
- The remote side-effects cache, a proof of concept ([v12](https://github.com/pnpm/pnpm/releases/tag/v12.0.0)).
- `dangerouslyAllowAllBuilds`: never.
- Agent skills (12.11.0): this repo has `.claude/`. Set `skills: { dirs: [] }` if packages start
  offering skills ([settings/build](https://pnpm.io/settings/build#skillsdirs)).

## 3. Risks, order of steps, and how to verify each

### Risks

- **R1 Lockfile conflicts.** Upstream syncs (owner decision 1) conflict on `pnpm-lock.yaml`, and so
  does every open factory branch cut before the merge. Resolve the same way: keep ours, re-apply the
  branch's `package.json` changes, and run `pnpm install`. Guard: step 6.
- **R2 `cloud/` frozen install** from the root `postinstall` (owner decision 2). If `cloud/` pins its
  own pnpm 8.15.4, pnpm 12 should hand over to that version and the install keeps working (step 0b
  probe) **[run]**. If it has no pin, or it moves to 12, it needs the same two hops.
- **R3 Release age on frozen installs.** pnpm 12 re-checks every locked entry against
  `minimumReleaseAge`/`trustPolicy` unless `trustLockfile: true`
  ([trustLockfile](https://pnpm.io/settings/dependency-resolution#trustlockfile)).
  `pnpm deploy --legacy` "fails with `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` when a locked version
  is too new ... as `pnpm install` does" ([v12.16.0](https://github.com/pnpm/pnpm/releases/tag/v12.16.0)).
  The built-in 1440-minute default is non-strict: pnpm then falls back to a too-new version when
  nothing older fits ([minimumReleaseAgeStrict](https://pnpm.io/settings/dependency-resolution#minimumreleaseagestrict)).
  The 12.3.0 changelog entry says non-strict mode records such versions in `minimumReleaseAgeExclude`.
  - Not established: whether a *frozen* CI install of a dependency bump made today fails or passes
    **[run]**. Settle it in step 4b.
  - If it fails, three fixes, preferred first: make bumps with pnpm 12 so the exclusion lands in
    `pnpm-workspace.yaml`; or add `minimumReleaseAgeExclude` entries by hand; or, last,
    `minimumReleaseAge: 0`.
- **R4 Docker deploy**: `ERR_PNPM_DEPLOY_AMBIGUOUS_PEER`, or the patch or `dist/` missing in `/out`
  **[run]**, step 5.
- **R5 Machines with pnpm 8 state**:
  - local checkouts and the git-checkout boxes behind `update.ts:240` keep a pnpm 8 `node_modules`.
    Filtered installs refuse it ([v12.16.0](https://github.com/pnpm/pnpm/releases/tag/v12.16.0)), so
    the first install on each must be unfiltered;
  - factory hosts (`factory.py:539`) need pnpm 12 on PATH before the merge (step 0b), or the 300 s
    install fails;
  - this machine's `.npmrc` network keys stop applying.
- **R6 CI runner**: `pnpm/action-setup@v6` is a Node 24 action ([v5.0.0](https://github.com/pnpm/action-setup/releases/tag/v5.0.0));
  the self-hosted pool must run it.
- **R7 EAS Build** with pnpm 12 is unverified (E6).

### Steps

Run builds and tests through Terminal Commander `run_and_watch` (never `| tail`, never sleep-polling).
Run one full suite at a time.

**Step 0 - branch.** `git switch -c chore/pnpm-12 origin/dev`. Save the old lockfile:
`cp pnpm-lock.yaml C:/temp/pnpm-lock.v6.yaml`.

**Step 0b - pnpm 12 on the hosts, before the merge.** `factory.py:539` installs in fresh worktrees
straight away, and `update.ts:240` runs on the next `rerun update`, so pnpm 12 has to be on those
machines before the merge, not after. Install it (`npm install -g pnpm@12.18.0`) on factory hosts and
git-checkout engine boxes. Then, in an untouched checkout still pinned to 8.15.4, run
`pnpm --version`. Per `pmOnFail: download` (E1) it should print 8.15.4, because pnpm 12 hands over
to the pinned version **[run]**. If it does, the hosts keep working on old branches and on the new one.

**Step 1 - hop 1, lockfile v6 -> v9 with pnpm 9.15.9 (versions unchanged).**

```sh
# pnpm 9 refuses a mismatched packageManager unless strictness is off (v9.0.0 notes)
COREPACK_ENABLE_STRICT=0 npx -y pnpm@9.15.9 install --lockfile-only
head -1 pnpm-lock.yaml                     # expect: lockfileVersion: '9.0'
node C:/temp/lockset.mjs C:/temp/pnpm-lock.v6.yaml pnpm-lock.yaml   # expect: onlyA=0 onlyB=0, exit 0
cp pnpm-lock.yaml C:/temp/pnpm-lock.v9-hop1.yaml
```

`lockset.mjs` compares the `name@version` sets of two lockfiles. It was tested on the v6 file
(2,635 entries); the v9 side is **[run]**:

```js
// C:/temp/lockset.mjs - name@version set difference between two pnpm lockfiles (v6 or v9).
import { readFileSync } from 'node:fs'
function set (path) {
  const out = new Set(); let inPackages = false
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (/^[a-zA-Z]/.test(line)) { inPackages = line === 'packages:'; continue }
    const m = inPackages && line.match(/^  '?\/?(.+?)'?:$/)
    if (m) out.add(m[1].replace(/\(.*$/, ''))
  }
  return out
}
const [a, b] = process.argv.slice(2).map(set)
const onlyA = [...a].filter(x => !b.has(x)), onlyB = [...b].filter(x => !a.has(x))
console.log(`A=${a.size} B=${b.size} onlyA=${onlyA.length} onlyB=${onlyB.length}`)
for (const x of onlyA) console.log('- ' + x); for (const x of onlyB) console.log('+ ' + x)
process.exitCode = onlyA.length || onlyB.length ? 1 : 0
```

A non-empty difference means pnpm 9 re-resolved something. Read it before going on.
Commit: `chore: convert pnpm-lock.yaml to lockfile v9 with pnpm 9.15.9`.

**Step 2 - hop 2 edits.** Apply E1-E7.

- Install pnpm 12 on this machine (`npm install -g pnpm@12.18.0`); `pnpm --version` shows 12.18.0.
- Move this machine's four `.npmrc` keys into `%LOCALAPPDATA%\pnpm\config\config.yaml` as
  `networkConcurrency: 4`, `fetchRetries: 6`, `fetchRetryMintimeout: 20000` and
  `fetchRetryMaxtimeout: 120000`. Network settings are allowed in the global file
  ([configuring](https://pnpm.io/configuring)). Then delete the four lines from `.npmrc`.
- For local Docker builds that should keep them, pass them as `pnpm_config_*` environment variables.

**Step 3 - pnpm 12 install, non-frozen, once.**

```sh
pnpm install                                   # unfiltered: recreates the pnpm 8 node_modules (v12.16.0 notes), rewrites patch hash/format and settings, adds eslint to apps/mobile
head -1 pnpm-lock.yaml                         # expect: lockfileVersion: '9.0'
node C:/temp/lockset.mjs C:/temp/pnpm-lock.v9-hop1.yaml pnpm-lock.yaml   # expect no version changes
git diff pnpm-workspace.yaml                   # expect only E2: no allowBuilds placeholders, no new minimumReleaseAgeExclude
node C:/temp/hasscript.mjs pnpm-lock.yaml      # expect the same 10 versions as section "What the repo has"
```

`hasscript.mjs` (tested on the current v6 lockfile: 2,119 names, 0 failures, the same 10 hits):

```js
// C:/temp/hasscript.mjs - locked package versions that have an install script, from npm's install metadata.
import { readFileSync } from 'node:fs'
const byName = new Map(); let inPackages = false
for (const line of readFileSync(process.argv[2], 'utf8').split(/\r?\n/)) {
  if (/^[a-zA-Z]/.test(line)) { inPackages = line === 'packages:'; continue }
  const m = inPackages && line.match(/^  '?\/?((?:@[^/]+\/)?[^@(]+)@([^(':]+)/)
  if (m) (byName.get(m[1]) ?? byName.set(m[1], new Set()).get(m[1])).add(m[2])
}
const names = [...byName.keys()], hits = []; let i = 0, fails = 0
async function worker () {
  while (i < names.length) {
    const name = names[i++]
    try {
      const r = await fetch('https://registry.npmjs.org/' + name.replace('/', '%2f'), { headers: { accept: 'application/vnd.npm.install-v1+json' } })
      const j = await r.json()
      for (const v of byName.get(name)) if (j.versions?.[v]?.hasInstallScript) hits.push(`${name}@${v}`)
    } catch (e) { fails++; console.error('fail', name, e.message) }
  }
}
await Promise.all(Array.from({ length: 16 }, worker))
console.log(`names=${names.length} fails=${fails}\n${hits.sort().join('\n')}`)
process.exitCode = fails ? 1 : 0
```

Commit: `chore: move to pnpm 12.18.0`.

**Step 4 - frozen installs in a clean clone, then the CI checks.**

```sh
git clone --no-local E:/project/rerun C:/temp/rerun-pnpm12 && cd C:/temp/rerun-pnpm12 && git switch chore/pnpm-12
pnpm install --frozen-lockfile && pnpm install --frozen-lockfile
git status --porcelain                         # expect empty (lockfile and workspace file untouched)
pnpm --filter @moldwright/contracts build && pnpm -r --if-present ts-check && pnpm -r --if-present lint
pnpm --filter rerun run test --maxWorkers=2 && pnpm --filter rerun-engine run test --maxWorkers=2
```

Then push and let CI run the same job (`ci.yml:22-38`) with `pnpm/action-setup@v6`. Remove
`C:/temp/rerun-pnpm12` afterwards.

**Step 4b - settle R3.** On a throwaway branch from step 4, bump one dependency to a version
published less than 24 hours ago, using pnpm 12 (`pnpm --filter rerun-engine add <pkg>@<new>`).
Push and watch whether CI's frozen install passes, and whether the bump wrote a
`minimumReleaseAgeExclude` entry. Delete the branch afterwards.

**Step 5 - both images.** The PR triggers the `images` job (`ci.yml:86`). Locally, build from an LF
context (`git -c core.autocrlf=false -c core.eol=lf archive`), then:

```sh
docker build -f apps/engine/Dockerfile -t rerun-engine:pnpm12 .   # the image runs its entrypoint self-test at build time (Dockerfile:29)
docker run --rm --entrypoint sh rerun-engine:pnpm12 -c 'test -f /app/dist/cli/bin.js && grep -c "rerun patch:" /app/node_modules/ai-sdk-provider-codex-cli/dist/index.cjs /app/node_modules/ai-sdk-provider-codex-cli/dist/index.js'
docker build -f apps/ui/Dockerfile -t rerun-ui:pnpm12 .            # check the log for ERR_PNPM_IGNORED_BUILDS / DEPLOY_AMBIGUOUS_PEER
```

Expect a count of 1 or more in both files and no `ERR_PNPM_*` lines. Then start the stack and open the
app (Charlotte), engine connected.

**Step 6 - guard against upstream drift.** Add one CI step after install, so a sync that brings back
a `package.json#pnpm` block fails instead of being ignored with a warning:
`node -e "process.exit(require('./package.json').pnpm ? 1 : 0)"`.

**Step 7 - per machine, after merge.**

- Every checkout: one unfiltered `pnpm install`.
- Git-checkout engine boxes and factory hosts: pnpm 12 was installed in step 0b. Their first
  unfiltered install after the merge replaces the pnpm 8 `node_modules`.
- EAS: one development build.
- `cloud/`: its own two hops, unless it stays pinned to 8.15.4 (see R2).
- Cleanup, once merged and pushed: `E:\.pnpm-store\v3` and the BuildKit `rerun-pnpm-store` v3 data
  are regenerable and can go.

### Rollback

Revert the two commits. The v6 lockfile and `package.json#pnpm` come back, and pnpm 8.15.4 reads
them as before. Images rebuild from the reverted Dockerfiles. Machines that already ran pnpm 12 need
`node_modules` removed and a pnpm 8 install, because pnpm 8 cannot read the v11 store layout. The
store directories sit side by side (`v3`, `v11`), so nothing is lost. Reversibility: moderate (one
PR, plus a per-machine reinstall).

## Case for staying on 8.15.4

- Upstream `rerun-build/rerun` is on 8.15.4 and is synced often. Staying keeps every sync
  conflict-free on the lockfile and the `pnpm` block.
- pnpm 8 is no longer in the compatibility table, which lists pnpm 10, 11 and 12 only
  ([installation](https://pnpm.io/installation)). npm `latest-8` is 8.15.9. I did not check for a
  published advisory against 8.15.4. This is a maintenance and supply-chain-default gain, not an
  emergency.

If the owner wants to wait for upstream to move first, the lowest-cost interim step is
**8.15.4 -> 8.15.9** (same lockfile v6). Everything above stays valid for later.

## Sources

- pnpm release notes: [v8.0.0](https://github.com/pnpm/pnpm/releases/tag/v8.0.0),
  [v8.7.0](https://github.com/pnpm/pnpm/releases/tag/v8.7.0),
  [v9.0.0](https://github.com/pnpm/pnpm/releases/tag/v9.0.0),
  [v10.0.0](https://github.com/pnpm/pnpm/releases/tag/v10.0.0),
  [v11.0.0](https://github.com/pnpm/pnpm/releases/tag/v11.0.0),
  [v12.0.0-rc.6](https://github.com/pnpm/pnpm/releases/tag/v12.0.0-rc.6),
  [v12.0.0](https://github.com/pnpm/pnpm/releases/tag/v12.0.0),
  [v12.2.0](https://github.com/pnpm/pnpm/releases/tag/v12.2.0),
  [v12.4.0](https://github.com/pnpm/pnpm/releases/tag/v12.4.0),
  [v12.16.0](https://github.com/pnpm/pnpm/releases/tag/v12.16.0)
- pnpm docs (source `pnpm/pnpm.io` `docs/`, 12.x): [migration](https://pnpm.io/migration),
  [migration-v11](https://pnpm.io/migration-v11), [installation](https://pnpm.io/installation),
  [docker](https://pnpm.io/docker), [deploy](https://pnpm.io/cli/deploy),
  [configuring](https://pnpm.io/configuring), [settings/build](https://pnpm.io/settings/build),
  [settings/dependency-resolution](https://pnpm.io/settings/dependency-resolution),
  [settings/store](https://pnpm.io/settings/store), [lockfile](https://pnpm.io/lockfile),
  [supply-chain-security](https://pnpm.io/supply-chain-security), [cli/patch](https://pnpm.io/cli/patch)
- [pnpm/action-setup releases](https://github.com/pnpm/action-setup/releases) and README;
  [corepack CHANGELOG](https://github.com/nodejs/corepack/blob/main/CHANGELOG.md). Tarballs read:
  `pnpm-12.18.0.tgz` (`bin/pnpm.mjs`, `package.json`, `CHANGELOG.md`) and `corepack-0.36.0.tgz`
  (`dist/lib/corepack.cjs` pnpm ranges).
- Registry: `npm view pnpm` (dist-tags, 12.18.0 engines `node >=18`, publish dates) and npm install
  metadata (`hasInstallScript`) for every locked package name.
