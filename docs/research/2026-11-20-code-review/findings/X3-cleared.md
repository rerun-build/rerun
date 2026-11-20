# `X3`: Cleared — Electron Desktop App IPC Origin Guard, Navigation & Deep-Link Token Handling

- **Status:** `cleared`
- **Checked:**
  - `apps/desktop-app/src/main/main-window.ts:63-110,178-201` (`openExternal`, `guardChildWindow`, `guardNavigation`, `appWindowOptions`)
  - `apps/desktop-app/src/main/url-policy.ts:1-61` (`EXTERNAL_PROTOCOLS`, `normalizeServerUrl`, `isSameOrigin`, `decideNavigation`, `decideWindowOpen`)
  - `apps/desktop-app/src/main/ipc-guard.ts:7-15` & `apps/desktop-app/src/main/ipc.ts:6-34` (`senderAudience`, `frameOf`, `handle`)
  - `apps/desktop-app/src/main/ipc-handlers.ts:18-97` (`registerIpcHandlers`)
  - `apps/desktop-app/src/main/deep-links.ts:8-35` & `apps/desktop-app/src/main/browser-sign-in.ts:28-88` (`parseDeepLink`, `startBrowserSignIn`, `completeFromLink`)
  - `apps/desktop-app/src/main/downloads.ts:16-45` & `apps/desktop-app/src/main/download-path.ts:3-18` (`showDownload`, `safeFilename`)
  - `pnpm --filter rerun-desktop test` (`7 passed (7), 32 passed (32)`)
- **Why it holds:** Every BrowserWindow and child window runs with `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, and `webSecurity: true` (`main-window.ts:105,193-196`). Every IPC handler checks `event.senderFrame` (`frame === event.sender.mainFrame` in `ipc.ts:9`) and matches `originOf(url)` strictly against `currentServer()` (`'app'`) or `rerun-shell://app` (`'local'`) (`ipc-guard.ts:8-14`), blocking iframes and third-party origins. `openExternal` (`main-window.ts:63-67`, `url-policy.ts:4,41-44`) allowlists strictly `https:`, `http:`, and `mailto:`, blocking `file:`, `smb:`, and custom OS RCE URI handlers; `downloadsShow` looks up opaque UUIDs in an in-memory `finished` `Map` (`downloads.ts:9,42-45`) with path-traversal-sanitized `safeFilename` (`download-path.ts:3-9`); and OAuth sign-in enforces PKCE (`S256` 32-byte `verifier`) plus 24-byte random `state` with a 15-minute TTL (`browser-sign-in.ts:31-36,75`).
