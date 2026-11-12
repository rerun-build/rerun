// What `pnpm verify:ui` and `pnpm verify:desktop` share: the checks that the hub runs on the local
// stack and never on production, the hub itself, the throwaway test account and its engine, and how a
// page is watched and judged settled.

import { execFileSync, spawn } from 'node:child_process'
import { createWriteStream, existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export const UI_DIR = join(REPO_ROOT, 'apps/ui')
export const PORT = Number(process.env.CONDUCTOR_PORT ?? 3050)
export const ENGINE_PORT = PORT + 1
export const WORKSPACE_NAME = (process.env.CONDUCTOR_WORKSPACE_NAME || basename(REPO_ROOT)).toLowerCase().replace(/[^a-z0-9-]/g, '-')
export const VIEWPORTS = { 375: { width: 375, height: 812 }, 768: { width: 768, height: 1024 }, 1440: { width: 1440, height: 900 } }
export const SHORT_VIEWPORT = { width: 1440, height: 700 }
const SERVER_READY_TIMEOUT_MS = 180_000

const fromEngine = createRequire(join(REPO_ROOT, 'apps/engine/package.json'))
const fromUi = createRequire(join(UI_DIR, 'package.json'))
export const { chromium } = fromEngine('patchright')
const { createClient } = fromUi('@supabase/supabase-js')

export function fail(message) {
    console.error(`\n[verify] ${message}\n`)
    process.exit(1)
}

export function log(message) {
    console.log(`[verify] ${message}`)
}

export function localStack() {
    let status
    try {
        status = execFileSync('pnpm', ['exec', 'supabase', 'status', '-o', 'env'], { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    } catch {
        fail('The local Supabase stack is not running. Start it with `pnpm db:start`.')
    }
    const read = (key) => status.match(new RegExp(`^${key}="?([^"\n]*)"?$`, 'm'))?.[1]
    return { url: read('API_URL'), secretKey: read('SECRET_KEY') ?? read('SERVICE_ROLE_KEY') }
}

// The Docker stack is shared by every worktree of the Mac and lags behind the branch: a column the
// code selects and the stack lacks answers 400 and the page renders as broken.
export function assertMigrated() {
    const listed = execFileSync('pnpm', ['exec', 'supabase', 'migration', 'list', '--local'], { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    const pending = listed
        .split('\n')
        .map((line) => line.match(/^\s*`?(\d*)`?\s*\|\s*`?(\d*)`?\s*\|/))
        .filter((match) => match && match[1] && !match[2])
        .map((match) => match[1])
    if (pending.length > 0) fail(`${pending.length} migrations are missing from the local stack (up to ${pending.at(-1)}). Run \`pnpm exec supabase migration up --local\`.`)
}

export function assertLocalProfile(stack) {
    const dotenv = existsSync(join(UI_DIR, '.env')) ? readFileSync(join(UI_DIR, '.env'), 'utf8') : ''
    const profile = dotenv.match(/^# >>> rerun env profile: (\S+)/m)?.[1]
    if (profile !== 'local') fail(`apps/ui/.env is on the "${profile ?? 'unknown'}" profile. Run \`pnpm cloud env:local\` first, never test against production.`)
    const configured = dotenv.match(/^NEXT_PUBLIC_SUPABASE_URL=(.*)$/m)?.[1]?.trim()
    if (configured !== stack.url) fail(`apps/ui/.env points at ${configured}, the running stack is ${stack.url}. Run \`pnpm cloud env:local\` again.`)
}

export function listeningPid(port) {
    try {
        return execFileSync('lsof', ['-nP', '-t', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' }).trim().split('\n')[0] || null
    } catch {
        return null
    }
}

export function processCwd(pid) {
    const out = execFileSync('lsof', ['-a', '-p', pid, '-d', 'cwd', '-Fn'], { encoding: 'utf8' })
    return out.split('\n').find((line) => line.startsWith('n'))?.slice(1) ?? ''
}

// Variables the process environment would hand Next ahead of `.env`: a session that exports
// production's Supabase or Bird keys would otherwise put the local hub back on production.
export function cleanServerEnv() {
    const env = { ...process.env }
    for (const key of Object.keys(env)) if (/SUPABASE|STRIPE|EXPO_PUBLIC/.test(key)) delete env[key]
    env.BIRD_API_KEY = ''
    return env
}

export async function waitFor(url) {
    const deadline = Date.now() + SERVER_READY_TIMEOUT_MS
    while (Date.now() < deadline) {
        try {
            const response = await fetch(url)
            if (response.ok) return
        } catch {}
        await new Promise((done) => setTimeout(done, 1000))
    }
    fail(`${url} did not answer within ${SERVER_READY_TIMEOUT_MS / 1000}s.`)
}

export function spawnLogged(command, args, options, logPath) {
    const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
    const logFile = createWriteStream(logPath)
    child.stdout.pipe(logFile)
    child.stderr.pipe(logFile)
    child.on('exit', (code) => code && console.error(`[verify] ${command} ${args.join(' ')} exited with ${code}, see ${logPath}`))
    return child
}

export async function ensureServer(base, outDir) {
    const pid = listeningPid(PORT)
    if (pid) {
        const cwd = processCwd(pid)
        if (!cwd.startsWith(REPO_ROOT)) fail(`Port ${PORT} is served from ${cwd}, another worktree. Stop it or set CONDUCTOR_PORT.`)
        const environ = execFileSync('ps', ['eww', '-o', 'command=', '-p', pid], { encoding: 'utf8' })
        if (/NEXT_PUBLIC_SUPABASE_URL=https:/.test(environ)) fail(`The server on port ${PORT} was started with a remote NEXT_PUBLIC_SUPABASE_URL in its environment. Restart it.`)
        log(`Reusing the hub already running on port ${PORT}.`)
        return null
    }
    log(`Starting next dev on port ${PORT}.`)
    const server = spawnLogged('pnpm', ['exec', 'next', 'dev', '-p', String(PORT)], { cwd: UI_DIR, env: cleanServerEnv() }, join(outDir, 'hub.log'))
    await waitFor(`${base}/api/version`)
    return server
}

export async function linkTestEngine(admin, userId) {
    const { data: user, error } = await admin.from('users').select('workspace_id').eq('id', userId).single()
    if (error) fail(`Could not read the test account's workspace: ${error.message}`)
    const workspaceId = user.workspace_id
    const apiKey = `verify-${WORKSPACE_NAME}-${workspaceId}`
    const { data: existing } = await admin.from('engine_pool').select('id').eq('claimed_by_workspace_id', workspaceId).maybeSingle()
    const row = { engine_host: `127.0.0.1:${ENGINE_PORT}`, engine_api_key: apiKey, status: 'claimed', claimed_by_workspace_id: workspaceId, provider: 'incus' }
    const write = existing ? admin.from('engine_pool').update(row).eq('id', existing.id) : admin.from('engine_pool').insert(row)
    const { error: writeError } = await write
    if (writeError) fail(`Could not link an engine to workspace ${workspaceId}: ${writeError.message}`)
    return { workspaceId, apiKey }
}

export async function markOnboarded(admin, workspaceId) {
    const { error } = await admin.from('workspaces').update({ onboarded_at: new Date().toISOString() }).eq('id', workspaceId).is('onboarded_at', null)
    if (error) fail(`Could not mark workspace ${workspaceId} onboarded: ${error.message}`)
}

export async function startEngine(base, apiKey, outDir) {
    if (listeningPid(ENGINE_PORT)) fail(`Port ${ENGINE_PORT} is already taken, the local engine needs it.`)
    log(`Starting the engine on port ${ENGINE_PORT}.`)
    const env = { ...process.env, RERUN_PORT: String(ENGINE_PORT), RERUN_HOST: '127.0.0.1', RERUN_API_KEY: apiKey, RERUN_HUB_BASE_URL: base, RERUN_DATA_DIR: join(REPO_ROOT, '.context/verify/engine-data') }
    const engine = spawnLogged('pnpm', ['--filter', 'rerun-engine', 'dev'], { cwd: REPO_ROOT, env }, join(outDir, 'engine.log'))
    await waitFor(`http://127.0.0.1:${ENGINE_PORT}/health`)
    return engine
}

export async function testAccount(stack, { fresh }) {
    const admin = createClient(stack.url, stack.secretKey, { auth: { persistSession: false } })
    const email = `verify-${WORKSPACE_NAME}@rerun.local`
    if (fresh) await deleteTestAccount(admin, email)
    const created = await admin.auth.admin.createUser({ email, email_confirm: true })
    if (created.error && !/already/i.test(created.error.message)) fail(`Could not create ${email}: ${created.error.message}`)
    const link = await admin.auth.admin.generateLink({ type: 'magiclink', email })
    if (link.error) fail(`Could not mint a sign-in link for ${email}: ${link.error.message}`)
    return { admin, email, userId: link.data.user.id, tokenHash: link.data.properties.hashed_token }
}

export async function deleteTestAccount(admin, email) {
    const { data: listed, error: listError } = await admin.auth.admin.listUsers({ perPage: 1000 })
    if (listError) fail(`Could not list the local accounts for --fresh: ${listError.message}`)
    const account = listed.users.find((user) => user.email === email)
    if (!account) return
    const { data: row } = await admin.from('users').select('workspace_id').eq('id', account.id).maybeSingle()
    if (row) await admin.from('engine_pool').delete().eq('claimed_by_workspace_id', row.workspace_id)
    const { error } = await admin.auth.admin.deleteUser(account.id)
    if (error) fail(`Could not delete ${email} for --fresh: ${error.message}`)
    log(`Deleted ${email} and its pool row.`)
}

// The web asks every new account for a phone number before the app opens. The throwaway account
// takes the wall's own "Skip for now".
export async function skipPhoneStep(admin, userId) {
    const { error } = await admin.from('user_phones').update({ skipped_at: new Date().toISOString() }).eq('user_id', userId).is('skipped_at', null)
    if (error) log(`Could not skip the phone step: ${error.message}`)
}

export async function signIn(context, base, account) {
    const page = await context.newPage()
    await signInPage(page, base, account)
    await page.close()
}

// Spends the account's magic link in a page already open (a browser tab, the desktop app's window).
export async function signInPage(page, base, account) {
    await page.goto(`${base}/auth/confirm?token_hash=${account.tokenHash}&type=magiclink`)
    // The confirm page is in the browser's language: its one submit button, whatever it says.
    await page.locator('form button[type="submit"]').first().click()
    await page.waitForURL((url) => !url.pathname.startsWith('/auth'), { timeout: 60_000 })
    await skipPhoneStep(account.admin, account.userId)
}

// Records what goes wrong on a page into `report`. Returns what stops the recording.
export function watch(page, report) {
    const onConsole = (message) => {
        if (message.type() === 'error' && !message.text().includes('/_next/hmr')) report.consoleErrors.push(message.text().slice(0, 500))
    }
    const onPageError = (error) => report.pageErrors.push(String(error).slice(0, 500))
    const onResponse = (response) => {
        if (response.status() >= 400) report.failedRequests.push(`${response.status()} ${response.request().method()} ${response.url()}`)
    }
    const onRequestFailed = (request) => {
        const reason = request.failure()?.errorText ?? ''
        if (!reason.includes('ERR_ABORTED')) report.failedRequests.push(`FAILED ${request.method()} ${request.url()} ${reason}`)
    }
    page.on('console', onConsole)
    page.on('pageerror', onPageError)
    page.on('response', onResponse)
    page.on('requestfailed', onRequestFailed)
    return () => {
        page.off('console', onConsole)
        page.off('pageerror', onPageError)
        page.off('response', onResponse)
        page.off('requestfailed', onRequestFailed)
    }
}

export async function timings(page) {
    return page.evaluate(
        () =>
            new Promise((done) => {
                const nav = performance.getEntriesByType('navigation')[0]
                let lcp = null
                new PerformanceObserver((list) => {
                    const last = list.getEntries().at(-1)
                    if (last) lcp = last.startTime
                }).observe({ type: 'largest-contentful-paint', buffered: true })
                setTimeout(
                    () =>
                        done({
                            ttfbMs: nav ? Math.round(nav.responseStart) : null,
                            domContentLoadedMs: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
                            loadMs: nav ? Math.round(nav.loadEventEnd) : null,
                            lcpMs: lcp === null ? null : Math.round(lcp),
                            horizontalOverflowPx: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
                        }),
                    100,
                )
            }),
    )
}

export const SETTLE_TIMEOUT_MS = 20_000

// Waits for the network to calm down and for every loading state (a "Loading…" label, a pulsing
// skeleton) to leave the screen. Answers false when one is still there at the deadline: a page stuck
// loading is a finding, not a capture to judge.
export async function settle(page) {
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})
    const settled = await page
        .waitForFunction(
            () => {
                const visible = (element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden'
                const skeleton = (element) => visible(element) && element.getBoundingClientRect().width > 24
                const pulsing = [...document.querySelectorAll('.animate-pulse, [data-slot="skeleton"]')].some(skeleton)
                const loadingLabel = [...document.querySelectorAll('body *')].some((element) => element.childElementCount === 0 && /^loading/i.test(element.textContent?.trim() ?? '') && visible(element))
                return !pulsing && !loadingLabel
            },
            null,
            { timeout: SETTLE_TIMEOUT_MS, polling: 250 },
        )
        .then(() => true)
        .catch(() => false)
    await page.waitForTimeout(500)
    return settled
}

export function slug(text) {
    return text.replace(/^\//, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '') || 'home'
}
