// More windows, and what the app no longer offers inside itself:
//   pnpm verify:desktop --scenario apps/desktop-app/e2e/launch.mjs

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

export default async function launchScenario({ app, page, step, base }) {
    await page.goto(base)
    await page.waitForSelector('[data-foreman-split]', { timeout: 60_000 })

    // The help menu offers the desktop app in a browser, never inside it.
    await page.getByRole('button', { name: /help/i }).first().click()
    await page.getByRole('menuitem').first().waitFor()
    check((await page.getByRole('menuitem', { name: 'Get the desktop app' }).count()) === 0, 'the app does not offer itself')
    await page.keyboard.press('Escape')

    await page.evaluate(() => sessionStorage.setItem('rerun:e2e-window', 'main'))
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('new-window').click())
    const second = await waitUntil(() => app.windows().filter((candidate) => candidate.url().startsWith(base)).find((candidate) => candidate !== page), Boolean, 'New Window opens a second window')
    await second.waitForSelector('[data-foreman-split]', { timeout: 60_000 })
    check(new URL(second.url()).pathname !== '/auth', 'the second window shares the session: signed in')
    check((await second.evaluate(() => window.rerunShell?.apiVersion)) === 1, 'the bridge is there too')
    check((await second.evaluate(() => sessionStorage.getItem('rerun:e2e-window'))) === null, 'each window keeps its own tab state (its workspace)')
    const bounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id).map((window) => window.getBounds()))
    check(bounds.length === 2 && bounds[1].x > bounds[0].x, 'the new window cascades from the first')
    await step('second window', { target: second })
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)[1].close())
    await waitUntil(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), (count) => count === 1, 'closing it leaves the main window')
}
