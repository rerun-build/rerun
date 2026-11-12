// Quick ask: the floating field for the Chief of Staff, end to end on the local hub:
//   pnpm verify:desktop --onboarded --scenario apps/desktop-app/e2e/quick-ask.mjs
//
// Playwright cannot press a global shortcut: the window is opened by the File menu's item, which
// runs the same toggle, and the shortcut's registration is checked on its own.

function check(condition, message) {
    if (!condition) throw new Error(`Check failed: ${message}`)
    console.log(`[e2e] ok: ${message}`)
}

async function waitUntil(read, predicate, message, timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs
    let value
    while (Date.now() < deadline) {
        value = await read()
        if (predicate(value)) return value
        await new Promise((done) => setTimeout(done, 250))
    }
    throw new Error(`Timed out: ${message} (last value: ${JSON.stringify(value)})`)
}

const QUESTION = 'What did my coworkers finish today?'

export default async function quickAskScenario({ app, page, step, base }) {
    await page.goto(base)
    await page.waitForSelector('[data-foreman-split]', { timeout: 60_000 })
    check(await app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('CommandOrControl+Shift+Space')), 'the global shortcut is registered')

    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)[0].hide())
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('quick-ask').click())
    const quick = await waitUntil(() => app.windows().find((candidate) => candidate.url().endsWith('/quick-ask')), Boolean, 'the Quick ask window opens')
    await quick.waitForSelector('[data-quick-ask] textarea')
    const box = await app.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().endsWith('/quick-ask'))
        return { visible: window.isVisible(), onTop: window.isAlwaysOnTop(), bounds: window.getBounds() }
    })
    check(box.visible && box.onTop && box.bounds.width === 640, `a small window floats on top (${JSON.stringify(box)})`)
    const strip = await quick.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--shell-titlebar-h').trim())
    check(strip === '0px', 'the Quick ask window has no title strip')
    await step('quick ask window', { target: quick })

    await quick.fill('[data-quick-ask] textarea', QUESTION)
    await step('quick ask typed', { target: quick })
    await quick.keyboard.press('Enter')
    await waitUntil(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().endsWith('/quick-ask'))?.isVisible() ?? false), (visible) => !visible, 'Enter puts the window away')
    await waitUntil(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)[0].isVisible()), Boolean, 'the main window comes back')
    await page.getByText(QUESTION).first().waitFor({ timeout: 30_000 })
    check(true, 'the question reaches the Chief of Staff in the main window')
    check((await page.evaluate(() => localStorage.getItem('rerun:quick-ask'))) === null, 'the handed-over text is taken once')
    await step('question asked in the main window')

    // Escape puts it away without sending anything.
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('quick-ask').click())
    await waitUntil(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().endsWith('/quick-ask'))?.isVisible() ?? false), Boolean, 'the window opens again')
    await quick.fill('[data-quick-ask] textarea', 'never sent')
    await quick.keyboard.press('Escape')
    await waitUntil(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().endsWith('/quick-ask'))?.isVisible() ?? false), (visible) => !visible, 'Escape puts it away')
    check((await page.getByText('never sent').count()) === 0, 'nothing is sent on Escape')
}
