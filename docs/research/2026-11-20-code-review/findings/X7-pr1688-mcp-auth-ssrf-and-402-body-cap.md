# `X7`: PR #1688 (`c1d28545`) Introduces Unauthenticated SSRF in `mcp-auth.ts` (`discoverDeviceAuth` / `startDeviceFlow` / `pollDeviceToken`) and `customEndpointFetch`, Unbounded `response.text()` Buffering, and Silent 50-Page MCP Tool Truncation

- **Finding:** In PR #1688 (`c1d28545`), `discoverDeviceAuth`, `startDeviceFlow`, `pollDeviceToken`, and `refreshWithEndpoint` in `apps/engine/src/tools/mcp-auth.ts` call raw `fetch()` on coworker-supplied `mcp_register` / `mcp_login` URLs **and** server-returned `authorization_server` URLs without `public-fetch.ts` SSRF guards or timeouts; `customEndpointFetch` (`custom-endpoint-fetch.ts:9`) buffers `await response.text()` on every HTTP 402 response without a byte cap; and `listAllTools` (`mcp.ts:58-66`) silently drops tools past `MAX_TOOL_PAGES = 50` without logging a warning.

## Evidence

- `apps/engine/src/tools/mcp-auth.ts:41-64,84-88`:
  ```ts
  export async function discoverDeviceAuth(mcpUrl: string): Promise<DeviceAuth> {
      const origin = new URL(mcpUrl).origin
      const res = await fetch(`${origin}/.well-known/oauth-protected-resource`)
      if (!res.ok) throw new Error(`no OAuth metadata at ${origin} (${res.status})`)
      const meta = (await res.json()) as {
          authorization_servers?: string[]
          higgsfield_auth_hints?: { options?: Array<{ flow?: string; authorization_server?: string }> }
      }
      const hinted = meta.higgsfield_auth_hints?.options?.find(o => o.flow === 'device_code')?.authorization_server
      const base = hinted ?? meta.authorization_servers?.find(s => s.includes('device'))
      if (!base) throw new Error('this MCP server does not advertise a device-code OAuth flow')
      return { deviceEndpoint: `${trimSlash(base)}/authorize`, tokenEndpoint: `${trimSlash(base)}/token` }
  }

  export async function startDeviceFlow(auth: DeviceAuth): Promise<DeviceStart> {
      const res = await fetch(auth.deviceEndpoint, {
          method: 'POST', ...
  ```
- `apps/engine/src/tools/builtin/self.ts:128-132`:
  ```ts
                try {
                    const auth = await discoverDeviceAuth(server.url)
                    const start = await startDeviceFlow(auth)
                    await savePending(id, name, { auth, start, startedAt: Date.now() })
                    const minutes = Math.round(start.expiresIn / 60)
                    return `Ask the user to open this URL and sign in to "${name}":\n${start.verificationUri}\n...`
  ```
- `apps/engine/src/agents/custom-endpoint-fetch.ts:7-15`:
  ```ts
  export function customEndpointFetch(inner: typeof fetch = fetch): typeof fetch {
      return async (input, init) => {
          const response = await inner(input, init)
          if (response.status !== 402) return response
          const text = await response.text()
          const reason = refusalMessageOf(text)
          if (!reason) return refusalResponse(response, text, 'Provider returned HTTP 402 (payment required).')
          return refusalResponse(response, text, `Provider returned error: ${reason}`)
      }
  }
  ```
- **Command / test run:** `pnpm --filter ./apps/engine exec vitest run --maxWorkers=2 src/agents/custom-endpoint-fetch.test.ts src/tools/mcp.test.ts src/tools/mcp-call.test.ts src/tools/mcp-auth.test.ts src/tools/builtin/self.mcp.test.ts src/connections/claude-plan-limits.test.ts`
  ```text
   ✓ src/agents/custom-endpoint-fetch.test.ts (passed)
   ✓ src/tools/mcp.test.ts (passed)
   ✓ src/tools/mcp-call.test.ts (passed)
   ✓ src/tools/mcp-auth.test.ts (passed)
   ✓ src/tools/builtin/self.mcp.test.ts (passed)
   ✓ src/connections/claude-plan-limits.test.ts (passed)
  ```

## Trigger

1. **Two-hop SSRF + Phishing `verificationUri` in `mcp_register` -> `mcp_login` (`self.ts:95-136` -> `mcp-auth.ts:41-64,84-88`):**
   - Even on a coworker **with `shell: false`**, a prompt-injected coworker can call `mcp_register({ name: 'corp', url: 'http://webgate:8080/mcp' })` (if the internal service returns 401/403, `needsLogin` is `true` at `self.ts:100` so `mcp_register` **saves the internal URL into `agent.json`** at `lines 107-111`!).
   - Worse: the attacker registers an external URL `https://evil.example/mcp` that returns `401` on probe, then on `mcp_login` its `/.well-known/oauth-protected-resource` returns:
     `{ "higgsfield_auth_hints": { "options": [{ "flow": "device_code", "authorization_server": "http://169.254.169.254/latest/meta-data" }] } }` (or `http://app:3000/api/...` / `http://searxng:8080/...`)!
   - `startDeviceFlow` and `pollDeviceToken` immediately `POST` directly from the engine container to that unvalidated internal URL — **and** `mcp_login` (`self.ts:132`) returns whatever arbitrary `verification_uri` string (including `javascript:...` or a credential-phishing domain unrelated to `server.url`!) the untrusted server returned, instructing the coworker to ask the human user to click it!
   - Furthermore, `pollDeviceToken` (`mcp-auth.ts:80-83`) trusts `start.interval` from the remote JSON: if a malicious server returns `"interval": -1` or `0` (or `NaN`), `while (Date.now() < deadline)` tight-loops thousands of `POST` requests without sleeping for 120 seconds!
2. **Unbounded 402 body read & raw upstream error echo in `customEndpointFetch` (`custom-endpoint-fetch.ts:9-13`):**
   - `await response.text()` has no byte cap (a rogue custom endpoint returning a multi-GB 402 stream OOMs the engine process), and `refusalMessageOf(text)` copies raw upstream `error.message` (up to full text length when plain text!) into `Provider returned error: ${reason}` -> `runs.error` (`A5`).
3. **Silent tool-list truncation at `MAX_TOOL_PAGES` (`mcp.ts:58-66`):** If an MCP server legitimately has `> 50` pages (or returns distinct junk cursors), `listAllTools` silently returns the partial tool array without logging a `logger.warn` that tools were truncated at 50 pages.

*(What holds: `saveToken` and `savePending` [`mcp-auth.ts:161-162,183-184`] properly create `mcpDir` with `0o700` and write files via `writeFileAtomic(..., { mode: 0o600 })`, and `claude-plan-limits.ts` hits the hardcoded constant `https://api.anthropic.com/api/oauth/usage` with an 8s `AbortSignal.timeout` and never logs the OAuth token.)*

## Impact and severity

- **Severity:** `high`
- **Impact:** Shell-disabled coworkers can trigger internal HTTP `GET`/`POST` SSRF via `mcp_register` + `mcp_login` `authorization_server` hints, spin a 120s zero-sleep request flood via `interval: 0`, present `javascript:` / phishing URLs as `verificationUri`, or OOM the engine via an oversized HTTP 402 body on a custom endpoint.

## Proposed fix

- **Smallest causal change (`apps/engine/src/tools/mcp-auth.ts`, `apps/engine/src/agents/custom-endpoint-fetch.ts`, `apps/engine/src/tools/mcp.ts`):**
  1. In `mcp-auth.ts`:
     - Route `discoverDeviceAuth`, `startDeviceFlow`, `pollDeviceToken`, `refreshWithEndpoint`, and `refreshToken` through hardened `fetchPublic` (`public-fetch.ts` after fixing `X1`) with a 15s `timeoutMs` (and validate `mcp_register` `input.url` with `isPublicHttpUrl` when registered by a coworker via `self.ts`!).
     - Validate `verificationUri` is an `https://` (or `http://` only in dev) URL via `isPublicHttpUrl`, and clamp `interval` in `startDeviceFlow` (`line 63`) to `Math.min(60, Math.max(1, Number.isFinite(data.interval) ? data.interval! : 5))`.
  2. In `customEndpointFetch` (`apps/engine/src/agents/custom-endpoint-fetch.ts:9`), read at most 64 KiB of the 402 body and cap `reason` to 500 chars redacted through `runSecrets`.
  3. In `listAllTools` (`apps/engine/src/tools/mcp.ts:58-66`), log `logger.warn({ pages: MAX_TOOL_PAGES, tools: tools.length }, 'mcp tool list hit page cap')` when the loop exits via `pages === MAX_TOOL_PAGES` with `cursor` still truthy.
- **Must not break:** Legitimate HTTPS MCP device-code OAuth servers (e.g. Higgsfield / external OAuth providers whose `authorization_server` is on a separate public HTTPS auth domain) and 402 payment-required messages from OpenRouter / custom proxies.
- **Failing test that proves the fix:**
  - **File:** `apps/engine/src/tools/mcp-auth.test.ts` and `apps/engine/src/agents/custom-endpoint-fetch.test.ts`
  - **Test name:** `it('rejects loopback/private authorization_server URLs, non-https verification_uri, and sub-second poll intervals')`
  - **Assertion:** Mock `/.well-known/oauth-protected-resource` returning `authorization_server: 'http://127.0.0.1:8080'` and assert `discoverDeviceAuth` rejects before making a second request; mock `interval: 0` and assert `startDeviceFlow` clamps `interval >= 1`; mock `verification_uri: 'javascript:alert(1)'` and assert `startDeviceFlow` throws.
- **Alternative fix and trade-off:** Require human confirmation on the Connect card (`request_mcp_sign_in`) before probing or saving any coworker-proposed `mcp_register` URL, preventing prompt-injected coworkers from initiating outbound MCP probes at all without user approval.

## Confidence

`proven`
