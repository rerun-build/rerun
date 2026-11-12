// The window chrome in the real window: the strip the web draws, the insets under it, a dialog over
// it, native full screen. With `--native` each step also captures the window as macOS draws it.
//   pnpm verify:desktop --native --scenario apps/desktop-app/e2e/title-bar.mjs

function check(condition, message) {
    if (!condition) throw new Error(`Check failed: ${message}`)
    console.log(`[e2e] ok: ${message}`)
}

async function waitUntil(read, predicate, message, timeoutMs = 15_000) {
    const deadline = Date.now() + timeoutMs
    let value
    while (Date.now() < deadline) {
        value = await read()
        if (predicate(value)) return value
        await new Promise((done) => setTimeout(done, 200))
    }
    throw new Error(`Timed out: ${message} (last value: ${JSON.stringify(value)})`)
}

const measure = (page) =>
    page.evaluate(() => {
        const strip = document.querySelector('[data-shell-titlebar]')
        const frame = document.querySelector('[data-foreman-split]')
        const stripBox = strip?.getBoundingClientRect()
        const frameBox = frame?.getBoundingClientRect()
        return {
            platform: document.documentElement.getAttribute('data-desktop-shell'),
            fullscreen: document.documentElement.hasAttribute('data-desktop-fullscreen'),
            strip: stripBox ? { top: stripBox.top, height: stripBox.height } : null,
            stripRegion: strip ? getComputedStyle(strip).getPropertyValue('app-region') || getComputedStyle(strip).getPropertyValue('-webkit-app-region') : null,
            frame: frameBox ? { top: frameBox.top, bottom: frameBox.bottom } : null,
            viewport: { width: innerWidth, height: innerHeight },
            overflowX: document.documentElement.scrollWidth - innerWidth,
            overflowY: document.documentElement.scrollHeight - innerHeight,
        }
    })

export default async function titleBarScenario({ app, page, step, base, shell }) {
    for (const theme of ['dark', 'light']) {
        await page.evaluate((value) => localStorage.setItem('theme', value), theme).catch(() => {})
        for (const [width, height] of [
            [1440, 900],
            [900, 640],
            [480, 760],
        ]) {
            await shell.resize(width, height)
            await page.goto(base)
            await page.waitForSelector('[data-foreman-split]', { timeout: 60_000 })
            const box = await measure(page)
            check(box.platform === 'mac' || box.platform === 'win' || box.platform === 'linux', `the server rendered the desktop chrome (${box.platform})`)
            const expected = box.platform === 'mac' ? 28 : 32
            check(box.strip?.top === 0 && box.strip.height === expected, `a ${expected} px strip sits at the top (${JSON.stringify(box.strip)})`)
            check(box.stripRegion === 'drag', `the strip drags the window (${box.stripRegion})`)
            check(Math.round(box.frame.top) === expected && Math.round(box.frame.bottom) === box.viewport.height, `the board frame fills the window under the strip (${JSON.stringify(box.frame)})`)
            check(box.overflowX <= 0 && box.overflowY <= 0, `nothing overflows at ${width}x${height} (${box.overflowX}, ${box.overflowY})`)
            await step(`board ${theme} ${width}x${height}`)
        }
    }

    // A dialog over the strip: centered in the space under it, the strip still a drag region.
    await shell.resize(1280, 800)
    await page.goto(base)
    await page.waitForSelector('[data-foreman-split]')
    await page.getByRole('button', { name: /workspace/i }).first().click()
    await page.getByRole('menuitem').first().waitFor()
    await step('workspace menu open')
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: /help/i }).first().click().catch(() => {})
    await page.keyboard.press('Escape')

    // Native full screen hides the traffic lights: the strip folds away and comes back.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)[0].setFullScreen(true))
    const full = await waitUntil(() => measure(page), (box) => box.fullscreen && box.strip?.height === 0, 'the strip folds in full screen')
    check(Math.round(full.frame.top) === 0, 'the board takes the whole screen')
    await step('full screen')
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)[0].setFullScreen(false))
    await waitUntil(() => measure(page), (box) => !box.fullscreen && box.strip?.height > 0, 'the strip comes back after full screen')
    await step('back from full screen')
}
