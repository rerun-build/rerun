# `X1`: `fetchPublic` (`public-fetch.ts`) Allows DNS-Rebinding TOCTOU and IPv4-Mapped IPv6 (`::ffff:[IP_ADDRESS]`) SSRF, and `firecrawl.ts` `isPublicUrl` Misses `[IP_ADDRESS]` / DNS Resolution

- **Finding:** `fetchPublic` in `apps/engine/src/lib/public-fetch.ts` suffers from both a DNS-rebinding TOCTOU race (resolving DNS in `assertPublicUrl` and then letting `fetch()` resolve DNS a second time unpinned) and an IPv4-mapped IPv6 blocklist gap (`::ffff:[IP_ADDRESS]` / `::ffff:[IP_ADDRESS]` are not matched by `NON_PUBLIC` IPv6 subnets), while `apps/ui/lib/company/firecrawl.ts` `isPublicUrl` checks only string prefixes without DNS resolution or `[IP_ADDRESS]` / `100.64.0.0/10` blocks.

## Evidence

- `apps/engine/src/lib/public-fetch.ts:19-26,42-50,67-70`:
  ```ts
  for (const [network, prefix] of [
      ['::', 127],
      ['fc00::', 7],
      ['fe80::', 10],
      ['ff00::', 8],
  ] as const)
      NON_PUBLIC.addSubnet(network, prefix, 'ipv6')
  ...
  export async function resolvesToPublicAddresses(hostname: string): Promise<boolean> {
      const host = hostname.replace(/^\[|\]$/g, '')
      try {
          const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookup(host, { all: true })
          return addresses.length > 0 && addresses.every(({ address, family }) => !NON_PUBLIC.check(address, family === 6 ? 'ipv6' : 'ipv4'))
      } catch {
          return false
      }
  }
  ...
      for (let hop = 0; ; hop++) {
          await assertPublicUrl(current)
          const res = await fetch(current, { ...init, redirect: 'manual', signal: init.signal ?? AbortSignal.timeout(timeoutMs) })
  ```
- `apps/ui/lib/company/firecrawl.ts:7,16-23`:
  ```ts
  const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[?::1\]?$)/i
  ...
  export function isPublicUrl(url: string): boolean {
      try {
          const { protocol, hostname } = new URL(url)
          return (protocol === 'https:' || protocol === 'http:') && hostname.includes('.') && !PRIVATE_HOST.test(hostname)
      } catch {
          return false
      }
  }
  ```
- **Command / test run:**
  1. `node -e "const {BlockList}=require('node:net'); const b=new BlockList(); b.addSubnet('[IP_ADDRESS]',8,'ipv4'); b.addSubnet('::',127,'ipv6'); b.addSubnet('fc00::',7,'ipv6'); b.addSubnet('fe80::',10,'ipv6'); b.addSubnet('ff00::',8,'ipv6'); console.log('v6 mapped check:', b.check('::ffff:7f00:1','ipv6'), new URL('http://[::ffff:[IP_ADDRESS]]:3000/health').hostname)"`:
     - Node `URL` normalizes `http://[::ffff:[IP_ADDRESS]]:3000` to hostname `[::ffff:7f00:1]`; `isIP('::ffff:7f00:1')` is `6`, and `NON_PUBLIC` has no `::ffff:0:0/96` subnet (or v4-mapped canonicalization), so `!NON_PUBLIC.check('::ffff:7f00:1', 'ipv6')` evaluates to **`true`**!
  2. `pnpm --filter ./apps/engine exec vitest run --maxWorkers=2 src/lib/public-fetch.test.ts` and `pnpm --filter ./apps/ui exec vitest run --maxWorkers=2 app/api/fetch/route.test.ts proxy.test.ts`:
     ```text
      ✓ src/lib/public-fetch.test.ts (passed)
      ✓ app/api/fetch/route.test.ts (10 tests) 31ms
      ✓ proxy.test.ts (16 tests) 23ms
     ```

## Trigger

1. **Direct IPv4-mapped IPv6 bypass (`http://[::ffff:[IP_ADDRESS]]:3000/...` or `http://[::ffff:[IP_ADDRESS]]/latest/meta-data/`):** A prompt-injected web page or user instructs a shell-disabled coworker (`tools.web = true, tools.shell = false`) to call `web_fetch` on `http://[::ffff:[IP_ADDRESS]]:3000/health` or `http://[::ffff:[IP_ADDRESS]]/...` (or an AAAA DNS record `attacker.example -> ::ffff:[IP_ADDRESS]`). `new URL(url).hostname` parses as `[::ffff:7f00:1]`, `isIP('::ffff:7f00:1')` returns `6`, `NON_PUBLIC` only added IPv4 subnets (`'ipv4'`) and 4 IPv6 subnets (`::/127`, `fc00::/7`, `fe80::/10`, `ff00::/8`) without `::ffff:0:0/96`! `assertPublicUrl` passes and `fetch` connects directly to `[IP_ADDRESS]:3000` on dual-stack Linux sockets!
2. **DNS-rebinding TOCTOU (`public-fetch.ts:68-69`):** An attacker domain with `TTL=0` (`rbndr.us` style) returns a public IP (`[IP_ADDRESS]`) on the `lookup()` call inside `assertPublicUrl` (`line 45`), then returns `[IP_ADDRESS]` or `172.18.0.x` (Docker `webgate` / `app` / `engine` container IP) on the unpinned `fetch(current)` call 1 ms later (`line 69`).
3. **`apps/ui` `/api/fetch` `isPublicUrl` (`firecrawl.ts:7,16-23`):** `PRIVATE_HOST` omits `[IP_ADDRESS]` (cloud metadata), `100.64.0.0/10` (Tailscale/CGNAT), IPv6 (`[::ffff:...]`, `[fc00::]`), decimal/hex IPv4 (`http://2130706433`), and performs no DNS resolution before forwarding `url` to Firecrawl/Crawl4AI (`https://crawl4ai.robagentic.tech` on the VPS!).

*(Note on `published-site`: `published-site/[slug]/[[...path]]/route.ts:259` strictly checks `extractPublishedSlug(host) === slug`, which returns `null` whenever `PUBLISH_HOST` is unset [`host.ts:45-46`], and `/p/[slug]` refuses `kind === 'site'` [`p/[slug]/route.ts:27`] while `published-view` renders HTML inside `sandbox="allow-scripts"` [`HtmlViewer`], so published HTML never executes on the main app origin.)*

## Impact and severity

- **Severity:** `high`
- **Impact:** Any coworker with `web_fetch` (even with `shell: false`) bypasses `public-fetch.ts` via `http://[::ffff:[IP_ADDRESS]]:3000` or DNS rebinding to read internal engine/Docker/cloud-metadata HTTP endpoints, and `/api/fetch` forwards `[IP_ADDRESS]` / DNS-rebound internal targets to the self-hosted Crawl4AI browser on the VPS.

## Proposed fix

- **Smallest causal change (`apps/engine/src/lib/public-fetch.ts`, `apps/ui/lib/company/firecrawl.ts`):**
  1. In `apps/engine/src/lib/public-fetch.ts:19-25`, add `['::ffff:0:0', 96]` (plus `['64:ff9b::', 96]`, `['100::', 64]`, `['2001:db8::', 32]`, `['2002::', 16]`) to `NON_PUBLIC` (`'ipv6'`), and pass a custom `undici` `Agent({ connect: { lookup: pinnedLookup } })` as `dispatcher` to `fetch()` in `fetchPublic` (`line 69`) that validates every `dns.lookup` result inside the socket connect hook itself — eliminating the TOCTOU window completely.
  2. In `apps/ui/lib/company/firecrawl.ts:16`, make `isPublicUrl` / `scrapePage` resolve DNS and check the exact same `BlockList` before calling `requestFirecrawl` (and add `::ffff:0:0/96` + DNS resolution to `deploy/vps/webgate/server.mjs:26-35` as well).
- **Must not break:** Normal HTTPS/HTTP `web_fetch` calls to public dual-stack (IPv4 + IPv6) domains and redirect chains up to `MAX_REDIRECTS`.
- **Failing test that proves the fix:**
  - **File:** `apps/engine/src/lib/public-fetch.test.ts`
  - **Test name:** `it('rejects IPv4-mapped IPv6 loopback/private addresses and re-validates DNS at socket connect time')`
  - **Assertion:** Assert `await expect(assertPublicUrl('http://[::ffff:[IP_ADDRESS]]:3000/health')).rejects.toThrow(NonPublicHostError)` and `await expect(assertPublicUrl('http://[::ffff:[IP_ADDRESS]]/latest/meta-data')).rejects.toThrow(NonPublicHostError)` (both resolve without throwing on `c1d28545`!).
- **Alternative fix and trade-off:** Route all coworker `web_fetch` traffic through an isolated forward proxy container on an egress-only Docker network with kernel `nftables` blocking RFC1918/loopback/link-local/ULA destinations. Defends native CLI `WebSearch` and `curl` too, at the cost of an extra container in `docker-compose.yml`.

## Confidence

`proven` (confirmed live via Node `net.BlockList` + `URL` evaluation on `::ffff:[IP_ADDRESS]`).
