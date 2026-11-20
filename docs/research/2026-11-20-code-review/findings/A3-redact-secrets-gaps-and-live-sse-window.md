# `A3`: `redactSecrets` / `secretValuesOf` Misses Connection Tokens, Non-Matching Key Names, Encoded/Split Output, and Native CLI Harness (`Claude Code` / `Codex`) Tool Outputs Until Post-Run DB Redaction

- **Finding:** `shell.ts:48` masks only exact plaintext substrings `>= 8` chars whose env variable name matches `/(TOKEN|KEY|SECRET|PASSWORD)/` in `shared.env` / `agent.env` (`shared-env.ts:5-6`), missing connection credentials (`CLAUDE_CODE_OAUTH_TOKEN`, `OPENAI_API_KEY` from `connections/<id>/.env`), variables like `DATABASE_URL` / `WEBHOOK_URI` / `COOKIE`, any base64/URL/line-wrapped output, and every native `Bash` tool call executed inside the Claude Code or Codex CLI harnesses (which stream raw unredacted output to live SSE listeners before `redactAgentTranscript` runs in `finally` at `loop.ts:635`).

## Evidence

- `apps/engine/src/agents/shared-env.ts:5-6,16-20`:
  ```ts
  const SECRET_NAME = /(TOKEN|KEY|SECRET|PASSWORD)/
  const SECRET_MIN_LENGTH = 8
  ...
  export function secretValuesOf(env: Record<string, string>): string[] {
      return Object.entries(env)
          .filter(([name, value]) => SECRET_NAME.test(name) && value.length >= SECRET_MIN_LENGTH)
          .map(([, value]) => value)
  }
  ```
- `apps/engine/src/tools/builtin/shell.ts:19-21,48` vs `apps/engine/src/runtime/loop.ts:184-186,635`:
  ```ts
  const secrets = secretValuesOf({ ...readSharedEnvSync(), ...ctx.agent.env })
  ```
  ```ts
  function runSecrets(agent: LoadedAgent): string[] {
      return [...Object.values(agent.env), ...Object.values(agent.resolved.connection?.env ?? {}), ...secretValuesOf(readSharedEnvSync())].filter(value => value.length >= 8)
  }
  ...
  await redactAgentTranscript(agent.id, runSecrets(agent)).catch(err => logger.warn({ err: String(err), agentId: agent.id }, 'transcript redaction failed'))
  ```
- **Command / test run:** `pnpm --filter ./apps/engine exec vitest run --maxWorkers=2 src/tools/builtin/shell.test.ts src/cli/commands/redact.test.ts`
  ```text
   ✓ src/tools/builtin/shell.test.ts (14 tests) 21ms
   ✓ src/cli/commands/redact.test.ts (passed)
  ```

## Trigger

*(What holds: No authorization check relies on `redactSecrets` as its primary access gate — `loop.ts:635` runs `redactAgentTranscript` as post-run hygiene.)*

However, three concrete gaps break even accidental-echo hygiene:
1. **Live SSE stream + LLM context receive unredacted secrets before `finally` (`loop.ts:498-516` vs `635`):**
   - For Claude Code (`Bash` tool) and Codex CLI (`shell`), tool outputs bypass `shell.ts` completely: the model itself sees the full unredacted secret in tool-result context (and can summarize/exfiltrate it), `appendMessage` / `recordToolCall` write the unredacted secret to `system.db`, and live SSE chat viewers receive the raw secret deltas in real time! Only *after* the entire run finishes (`finally` at `line 635`) does `redactAgentTranscript` scrub `system.db` via SQL `REPLACE()`.
2. **`shell.ts:48` filters `ctx.agent.env` by `SECRET_NAME` while `loop.ts:185` does not:**
   - If a user stores a coworker secret named `DATABASE_URL`, `SESSION_COOKIE`, `BEARER_CREDENTIAL`, or `WEBHOOK_AUTH` in `agent.env`, `shell.ts:48` (`secretValuesOf`) **does not mask it** in `shell_exec` output returned to the LLM, whereas `runSecrets` (`loop.ts:185`) treats *all* `Object.values(agent.env)` as secrets! And `shell.ts:48` also omits `ctx.agent.resolved.connection?.env` and `mcp/*.token.json` tokens!
3. **`shared.env` variables with non-matching names (`shared-env.ts:5`):** `SECRET_NAME = /(TOKEN|KEY|SECRET|PASSWORD)/` is case-sensitive and misses `DSN`, `URL` (with embedded `user:pass@host`), `COOKIE`, `AUTH`, and lowercase keys.

## Impact and severity

- **Severity:** `medium`
- **Impact:** Coworker `agent.env` secrets named `DATABASE_URL` / `WEBHOOK_AUTH` (and MCP OAuth tokens in `mcp/*.token.json`) are returned unmasked to the LLM by `shell_exec` and broadcast live over SSE before `finally` scrubs SQLite.

## Proposed fix

- **Smallest causal change (`apps/engine/src/tools/builtin/shell.ts`, `apps/engine/src/agents/shared-env.ts`, `apps/engine/src/runtime/loop.ts`):**
  1. Unify `shell.ts:48` and `loop.ts:184` on a single `agentSecretValues(agent)` helper that includes **all** `Object.values(agent.env)` (`length >= 8`), `Object.values(agent.resolved.connection?.env ?? {})`, `secretValuesOf(readSharedEnvSync())` (case-insensitive `/(TOKEN|KEY|SECRET|PASSWORD|AUTH|COOKIE|DSN|DATABASE_URL)/i`), and any stored `mcp/*.token.json` `accessToken`/`refreshToken` for `agent.id`.
  2. Redact `tool-output` text and `text-delta` chunks **before** `appendMessage` / `recordToolCall` / SSE broadcast in `loop.ts`, rather than waiting for `finally` (`line 635`) after SSE subscribers and concurrent readers already saw the plaintext.
- **Must not break:** Streaming performance on normal non-secret text deltas (skip replacement when `secrets.length === 0`).
- **Failing test that proves the fix:**
  - **File:** `apps/engine/src/tools/builtin/shell.test.ts`
  - **Test name:** `it('redacts every agent.env value >= 8 chars regardless of variable name, including DATABASE_URL')`
  - **Assertion:** Run `shellTools` with `agent.env = { DATABASE_URL: 'postgres://admin:supersecret@db/prod' }`, execute `echo $DATABASE_URL`, and assert the returned string contains `[REDACTED]` and never `supersecret`.
- **Alternative fix and trade-off:** Remove unrelated secrets from child process environments (`A2`) and isolate `/data` per coworker (`A1a`) so accidental-echo masking is purely defense-in-depth rather than compensating for shared secrets.

## Confidence

`proven`
