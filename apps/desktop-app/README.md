# Rerun desktop app

An Electron shell around the Rerun web app: the window loads the server (`https://app.rerun.build`,
or a self-hosted one) and everything a person sees is drawn by `apps/ui`. A web deploy reaches the
app without a desktop release. The shell only adds what a browser tab cannot: a native window and
menus, sign-in through the system browser, links and downloads that behave like a desktop app,
updates of its own.

```
src/main/       the main process: window, navigation rules, permissions, IPC, deep links, updater
src/preload/    exposes window.rerunShell (to the server's pages) and window.rerunShellLocal (to the
                shell's own pages), nothing to any other origin
src/renderer/   the shell's own pages, served from rerun-shell://app: offline, find bar, server picker
src/shared/     IPC channel names, the language packs of the shell
e2e/            scenarios played by `pnpm verify:desktop`, and the update loop
```

The contract with the web app is `packages/contracts/src/desktop-shell.ts`: `window.rerunShell`, its
`apiVersion` and its `capabilities`. The web reads it in one place, `apps/ui/lib/desktop-shell`, and
checks a capability before using it: an app stays installed for months while the web ships every day.
The server recognizes the app by the `RerunDesktop/<version> (<platform>; <channel>)` token of its
User-Agent and renders the desktop chrome from the first paint (`<html data-desktop-shell>`).

## Run it

```bash
pnpm dev:desktop                 # the development app ("Rerun Dev") on this workspace's hub
RERUN_DESKTOP_URL=https://staging.rerun.build pnpm dev:desktop
```

`RERUN_DESKTOP_URL` points a development or staging build at any server; a packaged stable build
ignores it. `RERUN_DESKTOP_USER_DATA` gives a run a data folder of its own.

## Channels

| Channel | App | Id | URL scheme | Server |
|---|---|---|---|---|
| `stable` | Rerun | `build.rerun.desktop` | `rerun-desktop://` | `RERUN_DESKTOP_DEFAULT_URL` (app.rerun.build in the official build) |
| `staging` | Rerun Staging | `build.rerun.desktop.staging` | `rerun-desktop-staging://` | staging.rerun.build |
| `dev` | Rerun Dev | `build.rerun.desktop.dev` | `rerun-desktop-dev://` | the local hub |

Each has its own data folder, icon (`pnpm icons` draws them from the iOS icon) and update feed. A
build from the sources without `RERUN_DESKTOP_DEFAULT_URL` opens on "Connect to your server". The
name and the icon are build parameters: a fork ships under its own (see `TRADEMARK.md`).

## Security

The window shows remote content, so: sandboxed renderer, context isolation, no Node in any page, a
preload that exposes a fixed API and never `ipcRenderer`. Every IPC handler checks the sending frame
(main frame, the server's origin or the shell's pages). Only the server navigates in the window; the
rest of the web opens in the browser, Stripe's hosted pages in a window of the app's session.
Permissions are refused unless the server asks for one its features use (notifications, clipboard,
microphone, screen capture, full screen). Fuses: no `RunAsNode`, no `NODE_OPTIONS`, no inspector
flags, cookies encrypted with the system keychain, the app loaded from its integrity-checked asar.

## Sign-in

Google refuses embedded web views, so Google and Apple sign in through the system browser (RFC 8252,
PKCE): the app opens `/auth/desktop` with a challenge, the person confirms in the browser, the browser
hands a one-time code back through the app's URL scheme (or shows it to paste), and the app spends it
with its verifier at `/api/desktop/auth/exchange` for a session of its own. Email and phone codes work
in the window as they do on the web. A service's sign-in (Gmail, an MCP server) takes the iOS app's
chain: a ticket, the browser, a claim back through the scheme.

## Self-hosted

"Connect to your server" (the menu's Change Server…, or the link under the sign-in methods) asks
`/api/desktop/config` whether the address is a Rerun hub that serves this version, warns about plain
http on another machine, and moves the app there: each server keeps its own session. The IPC guard
follows the server the window shows, not only the configured one.

## Native

- Notifications: the web's notifications go through the system's (`notifications.show`) as soon as the
  person is in another app; a click brings the window back and the page opens what it was about.
  Whether someone is looking comes from the window's state (`lib/desktop-shell/attention.ts`), since
  the window keeps its timers when hidden and `document.visibilityState` stays visible.
- The count of what waits: on the Dock (macOS), a dot over the taskbar button (Windows), the tray.
- A tray icon (menu bar on macOS): open, what waits, open at login, updates, quit. On Windows and
  Linux, closing the window leaves the app there (a setting); macOS keeps the app in the Dock.
- Open at login, started hidden; settings in the Desktop tab of the account (`settings.get/set`).
- A browser that signed the app in (cookie `rr_desktop_app`) offers once per tab to open the page in
  the app (`rerun-desktop://open?path=/…`, a path of the server and nothing else): the link of an
  email lands in the browser, the work happens in the app.
- Quick ask: ⌘⇧Space (Ctrl+Shift+Space) from any app opens a small floating field for the Chief of
  Staff (`/quick-ask`). The text goes to the main window through the origin's localStorage, never a
  URL a link could forge, and the main window asks it in a new conversation.
- Menus and tray in the language the person reads Rerun in (`locale.set`), a right-click menu
  (editing, spelling, links, images).

## Release

```bash
RERUN_DESKTOP_CHANNEL=staging RERUN_DESKTOP_DEFAULT_URL=https://staging.rerun.build pnpm --filter rerun-desktop package
```

Unsigned (ad hoc on macOS) unless signing credentials are in the environment: see
`electron-builder.config.ts`. The signed, notarized release and its upload to the update feed
(`downloads.rerun.build/desktop/<channel>/`) run in Rerun Cloud's private repository. A bad release is
pulled by publishing a higher version; `DESKTOP_MIN_SHELL_VERSION` on the server makes older apps
update before they load anything.

## Tests

```bash
pnpm --filter rerun-desktop test                                         # the rules, without Electron
pnpm verify:desktop --scenario apps/desktop-app/e2e/shell.mjs            # the window's rules
pnpm verify:desktop --native --scenario apps/desktop-app/e2e/title-bar.mjs
pnpm verify:desktop --signed-out --scenario apps/desktop-app/e2e/sign-in.mjs
pnpm verify:desktop --scenario apps/desktop-app/e2e/links.mjs
pnpm verify:desktop --scenario apps/desktop-app/e2e/native.mjs
pnpm verify:desktop --scenario apps/desktop-app/e2e/open-links.mjs
pnpm verify:desktop --onboarded --engine --scenario apps/desktop-app/e2e/quick-ask.mjs
pnpm verify:desktop --signed-out --scenario apps/desktop-app/e2e/self-hosted.mjs
pnpm verify:desktop --packaged --scenario apps/desktop-app/e2e/shell.mjs # the packaged app, fuses on
CSC_NAME="<a signing identity>" node apps/desktop-app/e2e/update-loop.mjs # 0.0.1 updates itself to 0.0.2
```

Playwright cannot click a system notification or a native menu, and under Playwright macOS does
not draw the traffic lights in a capture: those are checked by hand. Windows and Linux are built in
CI and need a real machine for the last look.
