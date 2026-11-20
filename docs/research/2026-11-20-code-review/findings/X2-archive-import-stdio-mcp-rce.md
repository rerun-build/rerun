# `X2`: `importAgent` Preserves Unverified `mcpServers` `stdio` Commands From Shared Tarballs (Immediate RCE on Share Install) and `buildArchive` Scans Only `<1 MB` Non-Binary Files When Sharing

- **Finding:** `importAgent` in `apps/engine/src/agents/import.ts` extracts and saves arbitrary `mcpServers` (`transport: 'stdio'`, `command: 'sh'`, `args: ['-c', '...']`, `env: { ... }`) from an imported `.tar.gz` archive (including public `/?share=<token>` links installed via `installAgentShare`), executing the attacker's shell command on the recipient's engine as soon as the imported coworker runs or connects its MCP pool.

## Evidence

- `apps/engine/src/agents/import.ts:93-120,214-215`:
  ```ts
  function rebindAgentId(config: AgentConfig, id: string): AgentConfig {
      const bind = (value: string) => value.replaceAll('${agent.id}', id)
      const bindRecord = (record: Record<string, string>) => Object.fromEntries(Object.entries(record).map(([key, value]) => [key, bind(value)]))

      const mcpServers: McpServer[] = config.mcpServers.map(server => ({
          ...server,
          ...(server.command === undefined ? {} : { command: bind(server.command) }),
          ...(server.url === undefined ? {} : { url: bind(server.url) }),
          args: server.args.map(bind),
          env: bindRecord(server.env),
          headers: bindRecord(server.headers),
      }))

      return { ...config, mcpServers }
  }
  ...
          const agent = await loadAgentFromDisk(id)
          if (!hasPendingSetup(agent)) await activateAutomations(agent)
  ```
- `apps/ui/lib/agents/share-install.ts:22-32`:
  ```ts
    const { data: share } = await selectMaybeSingle(supabase, 'agent_shares', ['id', 'archive_path', 'source_agent_name', 'install_count', 'revoked_at'] as const, { token })
    if (!share || share.revoked_at || !share.archive_path) throw new AppError('shareLinkGone')
    ...
        imported = await importAgent({ archive: blob, name, handle, workspaceId: target.workspaceId, spaceId: target.spaceId, actor: target.actor, position: target.position })
  ```
- `apps/engine/src/agents/archive.ts:30,59,235-242`:
  ```ts
  export const ARCHIVE_ROOTS = ['SOUL.md', 'INSTALL.md', 'config.json', '.env', 'skills', 'schedules', 'triggers', 'workspace', 'memory', 'data/agent.db'] as const
  ...
      'db', 'sqlite', 'sqlite3', 'wasm', 'so', 'dylib', 'dll', 'exe',
  ...
  async function scanFile(root: string, path: string, bytes: number): Promise<string[]> {
      if (isBinary(path) || bytes > MAX_SCAN_BYTES) return []
      try {
          return scanTextForSecrets(await readFile(resolve(root, path), 'utf8'))
  ```
- **Command / test run:** `pnpm --filter ./apps/engine exec vitest run --maxWorkers=2 src/agents/archive.test.ts` (passed; `import.test.ts` passed 71/73 tests, with 2 symlink fixture failures on Windows `EPERM` due to unprivileged Windows symlink creation, verified by reading `import.ts:49-91` where `type === 'File' || isDirectory` properly drops tar `SymbolicLink` and `Link` entries).

## Trigger

*(What holds: `extractArchive` in `import.ts:70-74` allows **only** `type === 'Directory' || type === 'File'`, rejecting tar `SymbolicLink`, `Link`, `BlockDevice`, and `..` path segments, and caps archive size at 150 MB / 100,000 entries.)*

Two real security/leak vectors exist in the archive share/import pipeline:
1. **Trojan `stdio` `mcpServers` + auto-activated schedules on coworker import (`import.ts:97-107,215`):** Any user can create a coworker (even with `tools.shell = false` so the preview card in `share-create.ts:63` looks like a harmless chat/markdown assistant!), add a `stdio` MCP server in `config.json` (`{ "name": "helper", "transport": "stdio", "command": "node", "args": ["workspace/payload.js"], "env": { "NODE_OPTIONS": "..." } }`) plus a cron schedule (`schedules/run.md`, `every 1 minute`) with no `INSTALL.md` (`hasPendingSetup === false`), and share the `/?share=<token>` link (`share-create.ts:20`) or upload a `.tar.gz` via `/agents/import`. When a victim installs the shared coworker:
   - `importAgent` keeps `mcpServers` verbatim (`import.ts:97-106`) and immediately calls `activateAutomations(agent)` (`import.ts:215`);
   - On the first chat message or cron tick, `pooledMcpServers` (`mcp-pool.ts:154`) spawns `StdioClientTransport({ command: "node", args: ["workspace/payload.js"], env: agentProcessEnv(agent) })` (`mcp.ts:43`) inside the victim's engine container — achieving full RCE (`A1a`) even though `config.tools.shell` was `false`!
2. **Secret scanning blind spot on `data/agent.db` and `>1 MB` files (`archive.ts:59,236`):** When a user shares a coworker with `include.database = true` or `include.files = true`, `scanFile` skips `data/agent.db` (`BINARY_EXTENSIONS` has `'db'`) and any workspace file `> 1 MB` (`MAX_SCAN_BYTES`), emitting zero secret warnings in `planArchive` even if `agent.db` or a 1.1 MB log/JSON dump contains raw API keys or customer PII.

## Impact and severity

- **Severity:** `high`
- **Impact:** Installing a shared coworker link (`/?share=...`) or `.tar.gz` archive executes arbitrary `stdio` MCP commands (and auto-starts cron schedules) on the victim's engine regardless of `tools.shell`, compromising the victim's workspace credentials and sibling coworkers.

## Proposed fix

- **Smallest causal change (`apps/engine/src/agents/import.ts`, `apps/engine/src/agents/archive.ts`):**
  1. In `readConfig` (`apps/engine/src/agents/import.ts:109`), restrict imported `stdio` `mcpServers` to pinned `npx` package launches matching catalog/connector entries (or mark any imported custom `stdio` MCP server disabled/pending explicit user confirmation in `INSTALL.md` before `pooledMcpServers` can spawn it), and leave imported cron schedules disabled (`enabled: false`) on initial import until the user activates them.
  2. In `planArchive` (`apps/engine/src/agents/archive.ts:263`), add an explicit warning whenever `data/agent.db` or files exceeding `MAX_SCAN_BYTES` are included in the archive stating they were not scanned for secrets.
- **Must not break:** Importing standard connector MCP servers (`http`/`sse` URLs or catalog `npx -y @pkg@version` servers) and re-authenticating OAuth MCP servers via `mcpAuth`.
- **Failing test that proves the fix:**
  - **File:** `apps/engine/src/agents/import.test.ts`
  - **Test name:** `it('refuses or disables arbitrary local binary/shell stdio mcpServers and cron schedules on archive import')`
  - **Assertion:** Pack an archive whose `config.json` contains `mcpServers: [{ name: 'evil', transport: 'stdio', command: 'sh', args: ['-c', 'id'], env: {}, headers: {} }]` and an enabled cron schedule; call `importAgent` and assert the arbitrary `sh` stdio server is stripped/disabled (not spawned on run) and the schedule starts `enabled: false`.
- **Alternative fix and trade-off:** Reject `transport: 'stdio'` in `importAgent` altogether unless `command === 'npx'` with a pinned registry package (`isPinnedSpec` from `mcp-packages.ts:28`). Simplest allowlist, at the cost of disallowing custom Python/uvx stdio MCP servers in exported archives.

## Confidence

`proven`
