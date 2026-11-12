// Sign-in through the system browser, end to end on the local hub:
//   pnpm verify:desktop --signed-out --scenario apps/desktop-app/e2e/sign-in.mjs
//
// The "system browser" is a Chromium of its own, signed in as the test account: it opens the URL
// the app hands to `shell.openExternal`, confirms, and the link it would open is handed to the app as
// macOS does (`open-url`). The code's own rules (one use, two minutes, the verifier) are played
// against the hub's route directly.

import { createHash, randomBytes } from 'node:crypto'
import { chromium, localStack, signInPage, testAccount } from '../../../scripts/verify/shared.mjs'

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

const DESKTOP_UA = 'Mozilla/5.0 (Macintosh) Chrome/156.0.0.0 Safari/537.36 RerunDesktop/0.1.0 (mac; dev)'

async function exchange(base, body, userAgent = DESKTOP_UA) {
    const response = await fetch(`${base}/api/desktop/auth/exchange`, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': userAgent }, body: JSON.stringify(body) })
    return { status: response.status, body: await response.json().catch(() => null), cookies: response.headers.getSetCookie() }
}

function pkcePair() {
    const verifier = randomBytes(32).toString('base64url')
    return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }
}

async function seedCode(admin, userId, challenge, { expired = false } = {}) {
    const code = randomBytes(32).toString('base64url')
    const { error } = await admin.from('desktop_auth_codes').insert({
        code_hash: createHash('sha256').update(code).digest('hex'),
        user_id: userId,
        code_challenge: challenge,
        expires_at: new Date(Date.now() + (expired ? -1000 : 120_000)).toISOString(),
    })
    if (error) throw new Error(error.message)
    return code
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

// The browser half: opens the hand-off page, confirms, and reads back the code and the link.
async function approveInBrowser(browserPage, url, step) {
    await browserPage.goto(url)
    await browserPage.getByRole('button', { name: 'Continue', exact: true }).waitFor({ timeout: 60_000 })
    await step('browser asks to confirm', { target: browserPage })
    let link = null
    browserPage.on('request', (request) => {
        if (request.url().startsWith('rerun-desktop-dev://')) link = request.url()
    })
    await browserPage.getByRole('button', { name: 'Continue', exact: true }).click()
    const code = await (await browserPage.waitForSelector('code', { timeout: 30_000 })).innerText()
    await step('browser hands the code back', { target: browserPage })
    const state = new URL(url).searchParams.get('state')
    return { code, state, link: link ?? `rerun-desktop-dev://auth/callback?code=${code}&state=${state}` }
}

async function openLink(app, link) {
    await app.evaluate(({ app: electronApp }, url) => electronApp.emit('open-url', { preventDefault() {} }, url), link)
}

export default async function signInScenario({ app, page, step, base, shell }) {
    // 1. A first launch opens on the sign-in page: no anonymous visitor in the app.
    await page.goto(base)
    await waitUntil(() => page.url(), (url) => new URL(url).pathname === '/auth', 'the app opens on /auth')
    const sessionCookies = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)[0].webContents.session.cookies.get({})).filter((cookie) => cookie.name.startsWith('sb-')).length)
    check(sessionCookies === 0, 'no session was minted for the window')
    await step('first launch: sign-in page')

    const stack = localStack()
    const account = await testAccount(stack, { fresh: false })
    const browser = await chromium.launch({ headless: true, args: ['--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests'] })
    const browserContext = await browser.newContext()
    const browserPage = await browserContext.newPage()
    try {
        await signInPage(browserPage, base, account)
        const opened = await stubSystemBrowser(app)

        // 2. The app hands the browser the hand-off page, with a PKCE challenge and a state.
        await page.evaluate(() => {
            window.__authResults = []
            window.rerunShell.auth.onResult((result) => window.__authResults.push(result))
        })
        await page.getByRole('button', { name: /google/i }).first().click()
        await page.getByRole('button', { name: /paste a code/i }).waitFor()
        await step('waiting for the browser')
        const [handoffUrl] = await waitUntil(opened, (urls) => urls.length === 1, 'the app opens the browser')
        const handoff = new URL(handoffUrl)
        check(handoff.searchParams.get('provider') === 'google' && handoff.pathname === '/auth/desktop' && /^[\w-]{43}$/.test(handoff.searchParams.get('challenge')) && handoff.searchParams.get('channel') === 'dev', `the browser gets /auth/desktop with a challenge (${handoff.pathname})`)
        check(!handoff.searchParams.has('verifier') && !handoffUrl.includes('verifier'), 'the verifier never leaves the app')

        // 3. A link with another state is refused, and spends nothing.
        const first = await approveInBrowser(browserPage, handoffUrl, step)
        await openLink(app, `rerun-desktop-dev://auth/callback?code=${first.code}&state=${'x'.repeat(32)}`)
        await waitUntil(() => page.evaluate(() => window.__authResults), (results) => results.some((result) => result.reason === 'state-mismatch'), 'a foreign state is refused')
        check(new URL(page.url()).pathname === '/auth', 'the app stays signed out after a foreign link')

        // 4. The right link signs the app in, on its own session.
        await openLink(app, first.link)
        await waitUntil(() => page.url(), (url) => new URL(url).pathname !== '/auth', 'the app leaves the sign-in page', 60_000)
        await page.waitForLoadState('domcontentloaded')
        const user = await page.evaluate(async () => (await fetch('/api/v1/me').catch(() => null))?.status ?? null)
        await step('signed in through the browser')
        const cookiesAfter = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)[0].webContents.session.cookies.get({})).filter((cookie) => cookie.name.startsWith('sb-')).length)
        check(cookiesAfter > 0, `the window holds its own session cookies (${cookiesAfter}, /api/v1/me answered ${user})`)

        // 5. The code's own rules, on the route.
        const pair = pkcePair()
        const good = await seedCode(account.admin, account.userId, pair.challenge)
        check((await exchange(base, { code: good, verifier: pkcePair().verifier })).status === 400, 'a wrong verifier is refused')
        const spent = await exchange(base, { code: good, verifier: pair.verifier })
        check(spent.status === 200 && spent.cookies.some((cookie) => cookie.startsWith('sb-')), 'the right verifier opens a session (the wrong one did not burn the code)')
        check((await exchange(base, { code: good, verifier: pair.verifier })).status === 400, 'a code works once')
        const late = await seedCode(account.admin, account.userId, pair.challenge, { expired: true })
        const lateAnswer = await exchange(base, { code: late, verifier: pair.verifier })
        check(lateAnswer.status === 400 && lateAnswer.body?.reason === 'expired', 'an expired code is refused as expired')
        const fresh = await seedCode(account.admin, account.userId, pair.challenge)
        check((await exchange(base, { code: fresh, verifier: pair.verifier }, 'Mozilla/5.0 Chrome/156')).status === 403, 'a browser cannot spend a code')
        check((await exchange(base, { code: 'short', verifier: pair.verifier })).status === 400, 'a malformed code is refused')

        // 6. Signed out again, the code pasted by hand works as well.
        await app.evaluate(async ({ BrowserWindow }) => BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)[0].webContents.session.clearStorageData({ storages: ['cookies'] }))
        await page.goto(base)
        await waitUntil(() => page.url(), (url) => new URL(url).pathname === '/auth', 'the app is back on /auth without cookies')
        await page.getByRole('button', { name: /apple/i }).first().click()
        const [, secondUrl] = await waitUntil(opened, (urls) => urls.length === 2, 'the browser opens again')
        check(new URL(secondUrl).searchParams.get('provider') === 'apple', 'the button names its provider to the browser')
        await page.getByRole('button', { name: /paste a code/i }).click()
        await step('waiting for the browser, paste field open')
        const second = await approveInBrowser(browserPage, secondUrl.replace('provider=apple', 'provider=none'), step)
        await page.getByRole('textbox').fill(second.code)
        await page.getByRole('button', { name: 'Sign in', exact: true }).click()
        await waitUntil(() => page.url(), (url) => new URL(url).pathname !== '/auth', 'the app leaves the sign-in page after the pasted code', 60_000)
        await step('signed in with the pasted code')
        void shell
    } finally {
        await browser.close()
    }
}
