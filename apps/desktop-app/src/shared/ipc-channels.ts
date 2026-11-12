import type { DesktopShellCapability, DesktopShellChannel, DesktopShellPlatform } from '@rerun/contracts'

// The IPC channels between the preload and the main process. Requests go through `invoke`, events
// come back on the `event:` channels.
export const IPC = {
    bootstrap: 'rerun-shell:bootstrap',
    windowGetState: 'rerun-shell:window:get-state',
    windowSetChrome: 'rerun-shell:window:set-chrome',
    findOpen: 'rerun-shell:find:open',
    linksOpenExternal: 'rerun-shell:links:open-external',
    downloadsShow: 'rerun-shell:downloads:show',
    updateGetState: 'rerun-shell:update:get-state',
    updateCheck: 'rerun-shell:update:check',
    updateInstall: 'rerun-shell:update:install',
    authStart: 'rerun-shell:auth:start',
    authSubmitCode: 'rerun-shell:auth:submit-code',
    localRetry: 'rerun-shell:local:retry',
    notificationsShow: 'rerun-shell:notifications:show',
    badgeSet: 'rerun-shell:badge:set',
    settingsGet: 'rerun-shell:settings:get',
    settingsSet: 'rerun-shell:settings:set',
    localeSet: 'rerun-shell:locale:set',
    quickAskClose: 'rerun-shell:quick-ask:close',
    quickAskSent: 'rerun-shell:quick-ask:sent',
    localServerInfo: 'rerun-shell:local:server-info',
    localServerConnect: 'rerun-shell:local:server-connect',
    localServerCancel: 'rerun-shell:local:server-cancel',
    localFind: 'rerun-shell:local:find',
    localFindClose: 'rerun-shell:local:find-close',
} as const

export const IPC_EVENTS = {
    windowState: 'rerun-shell:event:window-state',
    updateState: 'rerun-shell:event:update-state',
    authResult: 'rerun-shell:event:auth-result',
    download: 'rerun-shell:event:download',
    findResult: 'rerun-shell:event:find-result',
    findFocus: 'rerun-shell:event:find-focus',
    oauthReturn: 'rerun-shell:event:oauth-return',
    notificationClick: 'rerun-shell:event:notification-click',
} as const

export type AppBootstrap = {
    audience: 'app'
    apiVersion: number
    version: string
    platform: DesktopShellPlatform
    channel: DesktopShellChannel
    capabilities: readonly DesktopShellCapability[]
}

export type ShellBootstrap = AppBootstrap | { audience: 'local'; locale: string; platform: DesktopShellPlatform } | null

export type FindRequest = { text: string; forward: boolean; findNext: boolean }

export type FindResult = { active: number; total: number }

export type ServerInfo = { current: string | null; defaultServer: string | null; canCancel: boolean }

export type ServerConnectResult = { ok: true } | { ok: false; reason: 'invalid' | 'unreachable' | 'notRerun' | 'tooOld'; version?: string }
