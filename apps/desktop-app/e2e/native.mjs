// What makes the app native, end to end on the local hub:
//   pnpm verify:desktop --scenario apps/desktop-app/e2e/native.mjs
//
// The system draws notifications and the tray outside the window, where Playwright cannot click:
// the notification's `show` is stubbed to record it and click it, everything else is the real thing.

function check(condition, message) {
    if (!condition) throw new Error(`Check failed: ${message}`)
    console.log(`[e2e] ok: ${message}`)
}

async function waitUntil(read, predicate, message, timeoutMs = 20_000) {
    const deadline = Date.now() + timeoutMs
    let value
    while (Date.now() < deadline) {
        value = await read()
        if (predicate(value)) return value
        await new Promise((done) => setTimeout(done, 250))
    }
    throw new Error(`Timed out: ${message} (last value: ${JSON.stringify(value)})`)
}

const mainWindow = (BrowserWindow) => BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)[0]

export default async function nativeScenario({ app, page, step, base }) {
    await page.goto(base)
    await page.waitForSelector('[data-foreman-split]', { timeout: 60_000 })
    const capabilities = await page.evaluate(() => [...window.rerunShell.capabilities])
    check(['notifications', 'badge', 'settings', 'locale'].every((name) => capabilities.includes(name)), `the shell offers the native capabilities (${capabilities.join(', ')})`)

    // 1. A notification while the app is in the background: the system shows it, its click brings
    // the window back and hands the page the id it stands for.
    await app.evaluate(({ Notification }) => {
        globalThis.__notifications = []
        Notification.prototype.show = function show() {
            globalThis.__notifications.push({ title: this.title, body: this.body })
            setTimeout(() => this.emit('click'), 300)
        }
    })
    await page.evaluate(() => {
        window.__clicked = []
        window.rerunShell.notifications.onClick((id) => window.__clicked.push(id))
    })
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)[0].hide())
    const accepted = await page.evaluate(() => window.rerunShell.notifications.show({ id: 'notification-1', title: 'Researcher', body: 'Your report is ready' }))
    check(accepted === true, 'the system accepts the notification')
    const notified = await waitUntil(() => app.evaluate(() => globalThis.__notifications), (list) => list.length === 1, 'the notification is shown')
    check(notified[0].title === 'Researcher' && notified[0].body === 'Your report is ready', 'it carries the title and the text')
    await waitUntil(() => page.evaluate(() => window.__clicked), (ids) => ids.includes('notification-1'), 'the click reaches the page with its id')
    const visible = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)[0].isVisible())
    check(visible, 'the click brings the hidden window back')
    const attention = await page.evaluate(async () => (await window.rerunShell.window.getState()).visible)
    check(attention, 'the page sees the window visible again')
    void mainWindow

    // 2. The count of what waits, on the Dock (macOS) or the taskbar.
    await page.evaluate(() => window.rerunShell.badge.set(3))
    if (process.platform === 'darwin') {
        await waitUntil(() => app.evaluate(({ app: electronApp }) => electronApp.getBadgeCount()), (count) => count === 3, 'the Dock shows 3')
        await page.evaluate(() => window.rerunShell.badge.set(0))
        await waitUntil(() => app.evaluate(({ app: electronApp }) => electronApp.getBadgeCount()), (count) => count === 0, 'the Dock badge clears')
    }

    // 3. The desktop settings persist in the shell.
    const before = await page.evaluate(() => window.rerunShell.settings.get())
    check(before.closeToTray === true && before.openAtLogin === false, `the defaults: close to the tray, not at login (${JSON.stringify(before)})`)
    const after = await page.evaluate(() => window.rerunShell.settings.set({ closeToTray: false }))
    check(after.closeToTray === false, 'a setting changes')
    const reread = await page.evaluate(() => window.rerunShell.settings.get())
    check(reread.closeToTray === false, 'and reads back')
    await page.evaluate(() => window.rerunShell.settings.set({ closeToTray: true }))

    // 4. The menus follow the language the page tells.
    await page.evaluate(() => window.rerunShell.locale.set('fr'))
    const french = await waitUntil(() => app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.map((item) => item.label)), (labels) => labels.includes('Édition'), 'the menus switch to French')
    check(french.includes('Fenêtre'), `the menus read in French (${french.join(', ')})`)
    await page.evaluate(() => window.rerunShell.locale.set('en'))
    await waitUntil(() => app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.map((item) => item.label)), (labels) => labels.includes('Edit'), 'and back to English')

    // 5. The Desktop tab of the account, in the app only.
    await page.getByRole('button', { name: /workspace/i }).first().click()
    await page.getByRole('menuitem', { name: /account/i }).first().click()
    await page.getByRole('tab', { name: 'Desktop app' }).click()
    await page.getByText('Open at login').waitFor()
    await step('desktop tab of the account')
    check(await page.getByText('Rerun 0.1.0').isVisible(), 'the tab shows the app version')
}
