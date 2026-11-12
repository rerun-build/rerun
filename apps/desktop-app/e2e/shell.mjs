// The shell's own rules, end to end on the local hub:
//   pnpm verify:desktop --scenario apps/desktop-app/e2e/shell.mjs
//
// What a person cannot click (the system browser, a native dialog, the Downloads folder) is stubbed
// in the main process through `app.evaluate`; everything else goes through the real window.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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

async function stubSystemBrowser(app) {
    await app.evaluate(({ shell }) => {
        globalThis.__opened = []
        shell.openExternal = async (url) => {
            globalThis.__opened.push(url)
        }
    })
    return () => app.evaluate(() => globalThis.__opened)
}

export default async function shellScenario({ app, page, step, base }) {
    await page.goto(base)
    await page.waitForLoadState('domcontentloaded')
    await step('board in the desktop app')

    // 1. The bridge is there, for the server's origin, and says who it is.
    const identity = await page.evaluate(() => {
        const shell = window.rerunShell
        return shell ? { apiVersion: shell.apiVersion, version: shell.version, platform: shell.platform, channel: shell.channel, capabilities: [...shell.capabilities], frozen: Object.isFrozen(shell) || !('ipcRenderer' in window) } : null
    })
    check(identity && identity.apiVersion === 1 && identity.channel === 'dev', `window.rerunShell is exposed to the app (${JSON.stringify(identity)})`)
    check(identity.frozen, 'the page never sees ipcRenderer')
    const userAgent = await page.evaluate(() => navigator.userAgent)
    check(/RerunDesktop\/\d+\.\d+\.\d+ \((mac|win|linux); dev\)/.test(userAgent) && !/Electron\//.test(userAgent), `the User-Agent carries the shell token and hides Electron (${userAgent})`)

    // 2. Another origin gets no bridge, even in a window built with the same preload.
    const foreignOrigin = base.replace('localhost', '127.0.0.1')
    const foreign = await app.evaluate(async ({ BrowserWindow }, url) => {
        const main = BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)[0]
        const { preload } = main.webContents.getLastWebPreferences()
        const probe = new BrowserWindow({ show: false, webPreferences: { preload, sandbox: true, contextIsolation: true, session: main.webContents.session } })
        await probe.loadURL(`${url}/api/version`)
        const exposed = await probe.webContents.executeJavaScript('typeof window.rerunShell')
        probe.destroy()
        return exposed
    }, foreignOrigin)
    check(foreign === 'undefined', `a page of ${foreignOrigin} gets no window.rerunShell`)

    // 3. Leaving the server goes to the system browser, the window stays where it was.
    const opened = await stubSystemBrowser(app)
    const before = page.url()
    await page.evaluate(() => {
        location.href = 'https://example.com/from-a-link'
    })
    await waitUntil(opened, (urls) => urls.includes('https://example.com/from-a-link'), 'a navigation away opens the browser')
    check(page.url() === before, 'the window stays on the app after an external link')
    await page.evaluate(() => window.open('https://docs.rerun.build/', '_blank'))
    await waitUntil(opened, (urls) => urls.includes('https://docs.rerun.build/'), 'window.open of another site opens the browser')
    await page.evaluate(() => {
        location.href = 'file:///etc/hosts'
    })
    await page.waitForTimeout(500)
    check(page.url() === before && !(await opened()).some((url) => url.startsWith('file:')), 'a file:// link goes nowhere')
    const idsBefore = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((window) => window.id))
    await page.evaluate(() => window.open('about:blank', 'rerun-sign-in', 'popup=yes,width=500,height=640'))
    await waitUntil(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), (count) => count === idsBefore.length + 1, 'a blank popup stays a child window of the app')
    check(true, 'a sign-in popup opens as a child window in the app')
    await app.evaluate(({ BrowserWindow }, ids) => BrowserWindow.getAllWindows().filter((window) => !ids.includes(window.id)).forEach((window) => window.destroy()), idsBefore)

    // 4. Permissions: what the app uses, nothing else.
    const permissions = await page.evaluate(async () => {
        const notifications = await Notification.requestPermission()
        const geolocation = await new Promise((done) => navigator.geolocation.getCurrentPosition(() => done('granted'), (error) => done(`denied:${error.code}`), { timeout: 3000 }))
        const camera = await navigator.mediaDevices.getUserMedia({ video: true }).then(() => 'granted', (error) => `denied:${error.name}`)
        return { notifications, geolocation, camera }
    })
    check(permissions.notifications === 'granted', 'notifications are granted to the app')
    check(permissions.geolocation.startsWith('denied'), `geolocation is refused (${permissions.geolocation})`)
    check(permissions.camera.startsWith('denied'), `the camera is refused (${permissions.camera})`)

    // 5. A download lands in the Downloads folder, without a dialog, and the page hears about it.
    const downloads = mkdtempSync(join(tmpdir(), 'rerun-desktop-downloads-'))
    await app.evaluate(({ app: electronApp }, path) => electronApp.setPath('downloads', path), downloads)
    await page.evaluate(() => {
        window.__downloadEvents = []
        window.rerunShell.downloads.onEvent((event) => window.__downloadEvents.push(event))
        const link = document.createElement('a')
        link.href = URL.createObjectURL(new Blob(['a,b\n1,2\n'], { type: 'text/csv' }))
        link.download = '../escape attempt.csv'
        document.body.append(link)
        link.click()
        link.remove()
    })
    const events = await waitUntil(() => page.evaluate(() => window.__downloadEvents), (list) => list.some((event) => event.state === 'completed'), 'the download completes')
    const saved = readdirSync(downloads)
    check(saved.length === 1 && !saved[0].includes('/') && saved[0].endsWith('.csv'), `the file is saved inside Downloads (${saved.join(', ')})`)
    check(events.at(-1).filename.length > 0, 'the page receives the download events')

    // 6. The find bar opens over the page and finds text in it.
    await page.evaluate(() => window.rerunShell.find.open())
    const findPage = await waitUntil(() => app.windows().find((candidate) => candidate.url().startsWith('rerun-shell://app/find.html')), Boolean, 'the find bar opens')
    await findPage.waitForSelector('input')
    const word = await page.evaluate(() => (document.body.innerText.match(/[A-Za-z]{5,}/) ?? ['Rerun'])[0])
    await findPage.fill('input', word)
    await waitUntil(() => findPage.locator('[aria-live]').innerText(), (text) => /\d+/.test(text), `the find bar counts the matches of "${word}"`)
    await step('find bar with matches', { target: findPage })
    // Escape closes the bar's own page, which ends Playwright's handle on it mid-press.
    await findPage.keyboard.press('Escape').catch(() => {})
    await waitUntil(() => app.windows().some((candidate) => candidate.url().startsWith('rerun-shell://app/find.html')), (open) => !open, 'Escape closes the find bar')

    // 7. A page that blocks unloading gets a native confirmation instead of a stuck window.
    await app.evaluate(({ dialog }) => {
        globalThis.__unloadPrompts = 0
        dialog.showMessageBoxSync = () => {
            globalThis.__unloadPrompts += 1
            return 0
        }
    })
    await page.evaluate(() => window.addEventListener('beforeunload', (event) => event.preventDefault()))
    await page.mouse.click(5, 300)
    await page.evaluate(() => location.reload())
    await page.waitForLoadState('domcontentloaded')
    check((await app.evaluate(() => globalThis.__unloadPrompts)) === 1, 'beforeunload asks through a native dialog, and Leave reloads')

    // 8. Offline: the shell's page, then back to the app on its own when the network returns.
    // The hub is shared with other runs, so the server is cut off for this app only: every request to it fails.
    await app.evaluate(({ BrowserWindow }, origin) => {
        const session = BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)[0].webContents.session
        session.webRequest.onBeforeRequest({ urls: [`${origin}/*`] }, (_details, callback) => callback({ cancel: true }))
    }, base)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)[0].webContents.reload())
    await waitUntil(() => page.url(), (url) => url.startsWith('rerun-shell://app/offline.html'), 'the offline page shows')
    await page.waitForSelector('button')
    await step('offline page')
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)[0].webContents.session.webRequest.onBeforeRequest(null))
    await waitUntil(() => page.url(), (url) => url.startsWith(base), 'the app comes back by itself once online', 30_000)
    await page.waitForLoadState('domcontentloaded')
    await step('back online')

    // 9. A second launch hands over to the running app and quits.
    const electronPath = await app.evaluate(() => process.execPath)
    const userData = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'))
    const appPath = await app.evaluate(({ app: electronApp }) => electronApp.getAppPath())
    const second = spawnSync(electronPath, [appPath], { env: { ...process.env, RERUN_DESKTOP_USER_DATA: userData, RERUN_DESKTOP_URL: base }, timeout: 20_000 })
    check(second.status === 0, `a second instance exits at once (status ${second.status})`)
    check((await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)) === 1, 'the first instance keeps its single window')
    check(existsSync(userData), 'the run used its own data folder')
}
