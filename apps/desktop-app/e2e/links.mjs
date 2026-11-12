import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Links, popups, payments and downloads, end to end on the local hub:
//   pnpm verify:desktop --scenario apps/desktop-app/e2e/links.mjs

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

const windowUrls = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id).map((window) => window.webContents.getURL()))

export default async function linksScenario({ app, page, step, base }) {
    await page.goto(base)
    await page.waitForSelector('[data-foreman-split]', { timeout: 60_000 })
    await app.evaluate(({ shell }) => {
        globalThis.__opened = []
        shell.openExternal = async (url) => void globalThis.__opened.push(url)
    })
    const opened = () => app.evaluate(() => globalThis.__opened)

    // 1. ⌘F twice: the Control Center, then the shell's find bar.
    await page.locator('body').click({ position: { x: 600, y: 400 } }).catch(() => {})
    await page.keyboard.press('Meta+f')
    await page.waitForTimeout(400)
    await page.keyboard.press('Meta+f')
    await waitUntil(() => app.windows().some((candidate) => candidate.url().startsWith('rerun-shell://app/find.html')), Boolean, 'a second ⌘F opens the find bar')
    check(true, 'a second ⌘F opens the find bar')
    const findPage = app.windows().find((candidate) => candidate.url().startsWith('rerun-shell://app/find.html'))
    await findPage.keyboard.press('Escape').catch(() => {})

    // 2. Stripe Checkout takes a window of its own and gives the app back the return page.
    const before = (await windowUrls(app)).length
    await page.evaluate(() => {
        location.href = 'https://checkout.stripe.com/c/pay/cs_test_desktop_e2e'
    })
    const urls = await waitUntil(() => windowUrls(app), (list) => list.length === before + 1, 'Checkout opens in a window of the app')
    check(urls[0].startsWith(base), 'the main window stays on the app')
    check(!(await opened()).some((url) => url.includes('checkout.stripe.com')), 'Checkout does not leave for the browser')
    await app.evaluate(async ({ BrowserWindow }, target) => {
        const payment = BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id).at(-1)
        await payment.webContents.executeJavaScript(`location.href = ${JSON.stringify(target)}`).catch(() => {})
    }, `${base}/?billing=success`)
    await waitUntil(() => windowUrls(app), (list) => list.length === before, 'the payment window closes when Stripe sends the person back')
    await waitUntil(() => page.url(), (url) => url.includes('billing=success'), 'the app opens the return page')
    await step('back from Checkout')

    // 3. A page of the server opened in a new window hands any other site to the browser and closes.
    await page.evaluate((url) => window.open(url, '_blank'), `${base}/api/version`)
    await waitUntil(() => windowUrls(app), (list) => list.length === before + 1, 'a same-origin page opens in a child window')
    await app.evaluate(async ({ BrowserWindow }) => {
        const child = BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id).at(-1)
        await child.webContents.executeJavaScript(`location.href = 'https://published.example.rerun.site/?ticket=abc'`).catch(() => {})
    })
    await waitUntil(opened, (list) => list.includes('https://published.example.rerun.site/?ticket=abc'), 'the published page opens in the browser')
    await waitUntil(() => windowUrls(app), (list) => list.length === before, 'the hop window closes')

    // 4. A window opened only to download a file (a data export) closes once the file is saved.
    await app.evaluate(({ BrowserWindow, app: electronApp }, { origin, downloads }) => {
        electronApp.setPath('downloads', downloads)
        BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)[0].webContents.session.webRequest.onHeadersReceived({ urls: [`${origin}/api/version?export=*`] }, (details, callback) =>
            callback({ responseHeaders: { ...details.responseHeaders, 'Content-Disposition': ['attachment; filename="export.csv"'] } }),
        )
    }, { origin: base, downloads: mkdtempSync(join(tmpdir(), 'rerun-desktop-export-')) })
    await page.evaluate(() => {
        window.__downloads = []
        window.rerunShell.downloads.onEvent((event) => window.__downloads.push(event.state))
    })
    await page.evaluate((url) => window.open(url, '_blank'), `${base}/api/version?export=1`)
    await waitUntil(() => page.evaluate(() => window.__downloads), (states) => states.includes('completed'), 'the export downloads')
    await waitUntil(() => windowUrls(app), (list) => list.length === before, 'the export window closes after the download')
    await page.waitForSelector('[data-sonner-toast]', { timeout: 10_000 })
    await step('download toast')

    // 5. A service sign-in coming back from the browser reaches the page, which claims it.
    await page.evaluate(() => {
        window.__oauth = []
        window.rerunShell.oauth.onReturn((result) => window.__oauth.push(result))
    })
    await app.evaluate(({ app: electronApp }) => electronApp.emit('open-url', { preventDefault() {} }, 'rerun-desktop-dev://oauth/callback?status=success&claim=abcdefghijklmnopqrstuv'))
    const returned = await waitUntil(() => page.evaluate(() => window.__oauth), (list) => list.length === 1, 'the sign-in return reaches the page')
    check(returned[0].status === 'success' && returned[0].claim === 'abcdefghijklmnopqrstuv', 'the page gets the claim to spend')
    await app.evaluate(({ app: electronApp }) => electronApp.emit('open-url', { preventDefault() {} }, 'rerun-desktop://oauth/callback?status=success&claim=abcdefghijklmnopqrstuv'))
    await page.waitForTimeout(500)
    check((await page.evaluate(() => window.__oauth.length)) === 1, "another channel's link is ignored")
}
