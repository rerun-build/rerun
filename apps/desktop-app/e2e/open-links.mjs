// A page of Rerun opened in the app from a browser (`rerun-desktop://open?path=…`):
//   pnpm verify:desktop --scenario apps/desktop-app/e2e/open-links.mjs

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

const openLink = (app, url) => app.evaluate(({ app: electronApp }, link) => electronApp.emit('open-url', { preventDefault() {} }, link), url)

export default async function openLinksScenario({ app, page, step, base }) {
    await page.goto(base)
    await page.waitForSelector('[data-foreman-split]', { timeout: 60_000 })
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)[0].hide())

    await openLink(app, `rerun-desktop-dev://open?path=${encodeURIComponent('/?from=email&agent=abc')}`)
    await waitUntil(() => page.url(), (url) => url === `${base}/?from=email&agent=abc`, 'the link opens its page in the app')
    check(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)[0].isVisible()), 'and brings the window back')
    await step('page opened from a link')

    // The app tidies its own query afterwards: the page it settles on is the reference.
    await page.waitForTimeout(1500)
    const settled = page.url()
    for (const hostile of ['https://evil.example/', '//evil.example/x', 'javascript:alert(1)']) {
        await openLink(app, `rerun-desktop-dev://open?path=${encodeURIComponent(hostile)}`)
    }
    await openLink(app, `rerun-desktop://open?path=${encodeURIComponent('/elsewhere')}`)
    await page.waitForTimeout(1500)
    check(page.url() === settled && !page.url().includes('evil') && !page.url().includes('elsewhere'), 'hostile paths and another channel’s links go nowhere')
}
