// A self-hosted server, end to end:
//   pnpm verify:desktop --signed-out --scenario apps/desktop-app/e2e/self-hosted.mjs
//
// The second server is the same local hub reached as 127.0.0.1 instead of localhost: another origin,
// so another session, which is what a person with two servers gets.

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

const mainUrl = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id).at(-1)?.webContents.getURL())
const currentPage = (app, prefix) => app.windows().find((candidate) => candidate.url().startsWith(prefix))

export default async function selfHostedScenario({ app, page, step, base }) {
    await page.goto(base)
    await waitUntil(() => page.url(), (url) => new URL(url).pathname === '/auth', 'the app opens on the sign-in page')
    await page.getByRole('button', { name: 'Use another Rerun server' }).click()
    await waitUntil(() => mainUrl(app), (url) => url?.startsWith('rerun-shell://app/server.html'), 'the link opens "Connect to your server"')
    const picker = await waitUntil(() => currentPage(app, 'rerun-shell://app/server.html'), Boolean, 'the picker page is there')
    await picker.waitForSelector('#server-address')
    await step('connect to your server', { target: picker })

    await picker.fill('#server-address', 'http://192.168.1.20')
    await picker.getByText('This address is not encrypted', { exact: false }).waitFor()
    check(true, 'a plain http address on another machine is flagged')
    await picker.fill('#server-address', 'nothing-here.invalid')
    await picker.getByRole('button', { name: 'Connect' }).click()
    await picker.getByText('Nothing answered at this address.').waitFor({ timeout: 30_000 })
    check(true, 'an address where nothing answers says so')
    await step('unreachable address', { target: picker })

    const second = base.replace('localhost', '127.0.0.1')
    await picker.fill('#server-address', second)
    await picker.getByRole('button', { name: 'Connect' }).click()
    await waitUntil(() => mainUrl(app), (url) => url?.startsWith(second), `the app moves to ${second}`)
    const secondPage = await waitUntil(() => currentPage(app, second), Boolean, 'the window shows the second server')
    await waitUntil(() => secondPage.url(), (url) => new URL(url).pathname === '/auth', 'the second server has its own session: signed out')
    const shell = await secondPage.evaluate(() => window.rerunShell?.version ?? null)
    check(shell !== null, 'the bridge follows the window to the second server')
    const partitions = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((window) => window.webContents.session.storagePath))
    check(new Set(partitions).size === partitions.length, 'each server keeps its own data folder')
    await step('second server', { target: secondPage })

    // Back to the default server from the menu.
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.flatMap((item) => item.submenu?.items ?? []).find((item) => /Change Server/.test(item.label))?.click())
    const pickerAgain = await waitUntil(() => currentPage(app, 'rerun-shell://app/server.html'), Boolean, 'Change Server… opens the picker')
    await pickerAgain.waitForSelector('#server-address')
    check((await pickerAgain.inputValue('#server-address')) === second, 'the picker shows the current server')
    await pickerAgain.getByRole('button', { name: 'Use Rerun Cloud' }).click()
    await waitUntil(() => mainUrl(app), (url) => url?.startsWith(base), 'the app goes back to its default server')
}
