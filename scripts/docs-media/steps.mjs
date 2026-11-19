// Gestures several scenes share.

import { settle } from '../verify/shared.mjs'

export const body = ({ page }) => page.locator('body')
export const dialog = ({ page }) => page.getByRole('dialog')

export async function visit(page, base, path) {
    await page.goto(`${base}${path}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await settle(page)
}

export async function openWorkspaceMenu(page, base) {
    await visit(page, base, '/')
    await page.getByRole('button', { name: /Acme Studio/ }).first().click()
}

export async function openCoworker(page, base, coworker, tab) {
    await visit(page, base, `/?agent=${coworker.id}${tab ? `&tab=${tab}` : ''}`)
}

// The board opens on its first Box: two steps back show the three.
export async function showWholeBoard(page) {
    for (let step = 0; step < 2; step++) {
        await page.getByRole('button', { name: 'Zoom out', exact: true }).click()
        await page.waitForTimeout(600)
    }
}

// The coworker card has no landmark of its own: from an element inside it, climb to the first
// ancestor about as tall as the window, and frame that.
export async function panelAround(page, inner) {
    await inner.first().waitFor({ timeout: 20_000 })
    await inner.first().evaluate((element) => {
        for (const marked of document.querySelectorAll('[data-docs-frame]')) marked.removeAttribute('data-docs-frame')
        let node = element
        while (node.parentElement && node.getBoundingClientRect().height < window.innerHeight * 0.9) node = node.parentElement
        node.setAttribute('data-docs-frame', '')
    })
    return page.locator('[data-docs-frame]')
}

// The desktop app hands the page a `window.rerunShell`: a stand-in with the same shape lets the
// browser show the screens only the app shows. `remote` is this computer as the app sees it.
export async function asDesktopApp(page, { remote } = {}) {
    await page.addInitScript((remote) => {
        const noop = () => {}
        const unsubscribe = () => noop
        let settings = { openAtLogin: true, closeToTray: true, quickAsk: true, quickAskShortcut: 'Shift+Command+Space', quickAskVoiceShortcut: 'Alt+Shift+Space', coworkerDock: true }
        const remoteState = remote && { links: remote.links, paused: false, workDir: remote.workDir, secureStorage: true, runningJobs: 0, machine: remote.machine }
        window.rerunShell = {
            apiVersion: 1,
            version: '0.9.0',
            platform: 'mac',
            channel: 'stable',
            capabilities: ['window', 'links', 'update', 'notifications', 'badge', 'settings', 'locale', 'quickAsk', 'quickAskShortcut', 'quickAskVoice', 'quickAskVoiceShortcut', ...(remote ? ['remoteComputer'] : [])],
            window: { getState: async () => ({ focused: true, visible: true, fullscreen: false, maximized: false }), onState: unsubscribe, setChrome: noop },
            find: { open: noop },
            links: { openExternal: async () => true },
            update: { getState: async () => ({ status: 'idle' }), onState: unsubscribe, check: noop, install: noop },
            auth: { startBrowserSignIn: async () => {}, submitCode: async () => ({ status: 'signed-in' }), onResult: unsubscribe },
            downloads: { onEvent: unsubscribe, show: noop },
            oauth: { onReturn: unsubscribe },
            notifications: { show: async () => true, onClick: unsubscribe },
            badge: { set: noop },
            settings: { get: async () => settings, set: async (patch) => (settings = { ...settings, ...patch }) },
            locale: { set: noop },
            server: { openPicker: noop },
            quickAsk: {
                shortcut: 'CommandOrControl+Shift+Space',
                close: noop,
                sent: noop,
                setShortcut: async () => ({ status: 'ok', settings }),
                pauseShortcuts: noop,
                hold: noop,
                openMicrophoneSettings: async () => true,
                onShortcut: unsubscribe,
                onHidden: unsubscribe,
            },
            ...(remoteState
                ? { remoteComputer: { getState: async () => remoteState, onState: unsubscribe, link: async () => remoteState, unlink: async () => remoteState, setPaused: async () => remoteState, chooseWorkDir: async () => remoteState } }
                : {}),
        }
    }, remote ?? null)
}
