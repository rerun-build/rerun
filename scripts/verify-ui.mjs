#!/usr/bin/env node
// Opens the hub of this workspace in a real browser, signed in, and captures what a change looks like
// before anyone calls it done.
//
//   pnpm verify:ui /settings /templates                     every path, at every width, in both themes
//   pnpm verify:ui --scenario .context/verify/flow.mjs      a scripted walk: clicks, typing, a capture per step
//   pnpm verify:ui / --widths 375,1440 --themes dark --headed
//   pnpm verify:ui --engine --scenario …                     with a local engine behind the workspace
//   pnpm verify:ui --fresh /                                 a brand new account, to walk the signup
//   pnpm verify:ui --onboarded /                             an account past the onboarding
//   pnpm verify:ui --locale fr /                             the app in a language pack (fr, es, pt, de, or en-XA)
//
// Local stack only. The hub has to run on the Docker Supabase (`pnpm db:start`, then `pnpm cloud env:local`):
// a hub on production provisions a real user and a real workspace on every page load, and the
// production profile carries the live Stripe keys. The script checks both before the first request.
//
// It signs in as a throwaway account of its own, `verify-<workspace>@rerun.local`, created on the
// local stack through the admin API and opened through the app's own magic link page.
//
// Its workspace is linked to an engine on CONDUCTOR_PORT + 1, through a pool row of the local stack:
// without one, a workspace that has no machine sits behind the waitlist wall. `--engine` also starts
// that engine (data in `.context/verify/engine-data`), for the changes that need it to answer.
//
// The account outlives the run, so what a scenario builds is still there the next time; `--fresh`
// deletes it first.
//
// A scenario is a module whose default export receives `{ page, step, base, admin, workspaceId }`:
// `await step('name')` captures the page at that point, `page` is a Playwright page already signed in
// on the hub, `admin` a service-role client of the local stack to seed what the walk needs.
//
// Everything lands in `.context/verify/<timestamp>/`: one PNG per path, width and theme, and a
// `report.json` with the load timings, the console errors and every failed request.

import { execFileSync, spawn } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
    adminClient,
    assertRunningHubIsLocal,
    CHROMIUM_ARGS,
    cleanServerEnv,
    deleteAccount,
    linkEngine,
    listeningPid,
    markOnboarded,
    mintSignInLink,
    readLocalStack,
    REPO_ROOT,
    signIn,
    UI_DIR,
    workspaceOf,
} from '../apps/ui/e2e/support/local-stack.cjs'

const PORT = Number(process.env.CONDUCTOR_PORT ?? 3050)
const ENGINE_PORT = PORT + 1
const WORKSPACE_NAME = (process.env.CONDUCTOR_WORKSPACE_NAME || basename(REPO_ROOT)).toLowerCase().replace(/[^a-z0-9-]/g, '-')
const VIEWPORTS = { 375: { width: 375, height: 812 }, 768: { width: 768, height: 1024 }, 1440: { width: 1440, height: 900 } }
const SHORT_VIEWPORT = { width: 1440, height: 700 }
const SERVER_READY_TIMEOUT_MS = 180_000

const fromEngine = createRequire(join(REPO_ROOT, 'apps/engine/package.json'))
const { chromium } = fromEngine('patchright')

function fail(message) {
    console.error(`\n[verify] ${message}\n`)
    process.exit(1)
}

function log(message) {
    console.log(`[verify] ${message}`)
}

function parseArgs(argv) {
    const options = { paths: [], widths: [375, 768, 1440], themes: ['light', 'dark'], short: true, headed: false, keep: false, engine: false, fresh: false, onboarded: false, scenario: null, locale: null }
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]
        if (arg === '--widths') options.widths = argv[++i].split(',').map(Number)
        else if (arg === '--themes') options.themes = argv[++i].split(',')
        else if (arg === '--scenario') options.scenario = resolve(argv[++i])
        else if (arg === '--no-short') options.short = false
        else if (arg === '--headed') options.headed = true
        else if (arg === '--keep') options.keep = true
        else if (arg === '--engine') options.engine = true
        else if (arg === '--fresh') options.fresh = true
        else if (arg === '--onboarded') options.onboarded = true
        else if (arg === '--locale') options.locale = argv[++i]
        else if (arg.startsWith('/')) options.paths.push(arg)
        else fail(`Unknown argument: ${arg}`)
    }
    for (const width of options.widths) if (!VIEWPORTS[width]) fail(`Width ${width} is not one of ${Object.keys(VIEWPORTS).join(', ')}.`)
    if (options.paths.length === 0 && !options.scenario) options.paths.push('/')
    return options
}

// The Docker stack is shared by every worktree of the Mac and lags behind the branch: a column the
// code selects and the stack lacks answers 400 and the page renders as broken.
function assertMigrated() {
    const listed = execFileSync('pnpm', ['exec', 'supabase', 'migration', 'list', '--local'], { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    const pending = listed
        .split('\n')
        .map((line) => line.match(/^\s*`?(\d*)`?\s*\|\s*`?(\d*)`?\s*\|/))
        .filter((match) => match && match[1] && !match[2])
        .map((match) => match[1])
    if (pending.length > 0) fail(`${pending.length} migrations are missing from the local stack (up to ${pending.at(-1)}). Run \`pnpm exec supabase migration up --local\`.`)
}

function assertLocalProfile(stack) {
    const dotenv = existsSync(join(UI_DIR, '.env')) ? readFileSync(join(UI_DIR, '.env'), 'utf8') : ''
    const profile = dotenv.match(/^# >>> rerun env profile: (\S+)/m)?.[1]
    if (profile !== 'local') fail(`apps/ui/.env is on the "${profile ?? 'unknown'}" profile. Run \`pnpm cloud env:local\` first, never test against production.`)
    const configured = dotenv.match(/^NEXT_PUBLIC_SUPABASE_URL=(.*)$/m)?.[1]?.trim()
    if (configured !== stack.url) fail(`apps/ui/.env points at ${configured}, the running stack is ${stack.url}. Run \`pnpm cloud env:local\` again.`)
}

async function waitFor(url) {
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

function spawnLogged(command, args, options, logPath) {
    const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
    const logFile = createWriteStream(logPath)
    child.stdout.pipe(logFile)
    child.stderr.pipe(logFile)
    child.on('exit', (code) => code && console.error(`[verify] ${command} ${args.join(' ')} exited with ${code}, see ${logPath}`))
    return child
}

async function ensureServer(base, outDir) {
    if (assertRunningHubIsLocal(PORT)) {
        log(`Reusing the hub already running on port ${PORT}.`)
        return null
    }
    log(`Starting next dev on port ${PORT}.`)
    const server = spawnLogged('pnpm', ['exec', 'next', 'dev', '-p', String(PORT)], { cwd: UI_DIR, env: cleanServerEnv() }, join(outDir, 'hub.log'))
    await waitFor(`${base}/api/version`)
    return server
}

async function startEngine(base, apiKey, outDir) {
    if (listeningPid(ENGINE_PORT)) fail(`Port ${ENGINE_PORT} is already taken, the local engine needs it.`)
    log(`Starting the engine on port ${ENGINE_PORT}.`)
    const env = { ...process.env, RERUN_PORT: String(ENGINE_PORT), RERUN_HOST: '127.0.0.1', RERUN_API_KEY: apiKey, RERUN_HUB_BASE_URL: base, RERUN_DATA_DIR: join(REPO_ROOT, '.context/verify/engine-data') }
    const engine = spawnLogged('pnpm', ['--filter', 'rerun-engine', 'dev'], { cwd: REPO_ROOT, env }, join(outDir, 'engine.log'))
    await waitFor(`http://127.0.0.1:${ENGINE_PORT}/health`)
    return engine
}

function watch(page, report) {
    page.on('console', (message) => {
        if (message.type() === 'error' && !message.text().includes('/_next/hmr')) report.consoleErrors.push(message.text().slice(0, 500))
    })
    page.on('pageerror', (error) => report.pageErrors.push(String(error).slice(0, 500)))
    page.on('response', (response) => {
        if (response.status() >= 400) report.failedRequests.push(`${response.status()} ${response.request().method()} ${response.url()}`)
    })
    page.on('requestfailed', (request) => {
        const reason = request.failure()?.errorText ?? ''
        if (!reason.includes('ERR_ABORTED')) report.failedRequests.push(`FAILED ${request.method()} ${request.url()} ${reason}`)
    })
}

async function timings(page) {
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

const SETTLE_TIMEOUT_MS = 20_000

// Waits for the network to calm down and for every loading state (a "Loading…" label, a pulsing
// skeleton) to leave the screen. Answers false when one is still there at the deadline: a page stuck
// loading is a finding, not a capture to judge.
async function settle(page) {
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

function slug(text) {
    return text.replace(/^\//, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '') || 'home'
}

async function capturePaths(context, base, options, outDir) {
    const results = []
    const sizes = options.widths.map((width) => ({ name: String(width), viewport: VIEWPORTS[width] }))
    if (options.short) sizes.push({ name: '1440x700', viewport: SHORT_VIEWPORT })
    for (const path of options.paths) {
        for (const theme of options.themes) {
            for (const size of sizes) {
                const report = { path, theme, size: size.name, consoleErrors: [], pageErrors: [], failedRequests: [] }
                const page = await context.newPage()
                await page.addInitScript((value) => localStorage.setItem('theme', value), theme)
                await page.setViewportSize(size.viewport)
                watch(page, report)
                await page.goto(`${base}${path}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
                report.stillLoading = !(await settle(page))
                report.finalUrl = page.url().replace(base, '')
                report.timings = await timings(page)
                report.screenshot = join(outDir, `${slug(path)}.${theme}.${size.name}.png`)
                await page.screenshot({ path: report.screenshot, fullPage: false })
                await page.close()
                results.push(report)
                const flags = [report.stillLoading && 'STILL LOADING', report.timings.horizontalOverflowPx && `overflow ${report.timings.horizontalOverflowPx}px`, report.pageErrors.length && `${report.pageErrors.length} page errors`, report.consoleErrors.length && `${report.consoleErrors.length} console errors`].filter(Boolean)
                log(`${path} ${theme} ${size.name}: LCP ${report.timings.lcpMs ?? '?'} ms${flags.length ? ` · ${flags.join(' · ')}` : ''}`)
            }
        }
    }
    return results
}

async function runScenario(context, base, options, outDir, seed) {
    const report = { scenario: options.scenario, steps: [], consoleErrors: [], pageErrors: [], failedRequests: [] }
    const page = await context.newPage()
    await page.addInitScript((value) => localStorage.setItem('theme', value), options.themes[0])
    await page.setViewportSize(VIEWPORTS[options.widths.at(-1)])
    watch(page, report)
    let index = 0
    const step = async (name) => {
        const settled = await settle(page)
        const screenshot = join(outDir, `scenario.${String(++index).padStart(2, '0')}.${slug(name)}.png`)
        await page.screenshot({ path: screenshot })
        report.steps.push({ name, url: page.url().replace(base, ''), screenshot, stillLoading: !settled, at: new Date().toISOString() })
        log(`step ${index}: ${name}${settled ? '' : ' · STILL LOADING'}`)
    }
    const { default: scenario } = await import(pathToFileURL(options.scenario).href)
    try {
        await scenario({ page, step, base, ...seed })
    } catch (error) {
        report.error = String(error?.stack ?? error)
        await step('failure').catch(() => {})
        log(`Scenario failed: ${error?.message ?? error}`)
    }
    await page.close()
    return report
}

const options = parseArgs(process.argv.slice(2))
const stack = readLocalStack()
assertLocalProfile(stack)
assertMigrated()

const base = `http://localhost:${PORT}`
const outDir = join(REPO_ROOT, '.context/verify', new Date().toISOString().replace(/[:.]/g, '-'))
mkdirSync(outDir, { recursive: true })
const server = await ensureServer(base, outDir)

const browser = await chromium.launch({ headless: !options.headed, args: CHROMIUM_ARGS })
// A language pack is picked by the cookie the Account dialog writes, and the browser asks for it too.
// The test accounts (`@rerun.local`) are in the early access of the language packs.
const context = await browser.newContext(options.locale ? { locale: options.locale } : {})
await context.addCookies([
    { name: 'rerun-consent', value: `v1:denied:${Date.now()}`, url: base },
    ...(options.locale ? [{ name: 'NEXT_LOCALE', value: options.locale, url: base }] : []),
])
let failed = false
let engine = null
try {
    const admin = adminClient(stack)
    const email = `verify-${WORKSPACE_NAME}@rerun.local`
    if (options.fresh && (await deleteAccount(admin, email))) log(`Deleted ${email} and its pool row.`)
    const link = await mintSignInLink(admin, email)
    await signIn(context, base, admin, link)
    const workspaceId = await workspaceOf(admin, link.userId)
    const apiKey = `verify-${WORKSPACE_NAME}-${workspaceId}`
    await linkEngine(admin, workspaceId, { engineHost: `127.0.0.1:${ENGINE_PORT}`, apiKey })
    if (options.onboarded) await markOnboarded(admin, workspaceId)
    if (options.engine) engine = await startEngine(base, apiKey, outDir)
    log(`Signed in as ${email}, workspace ${workspaceId}.`)

    const pages = options.paths.length > 0 ? await capturePaths(context, base, options, outDir) : []
    const scenario = options.scenario ? await runScenario(context, base, options, outDir, { admin, workspaceId }) : null
    writeFileSync(join(outDir, 'report.json'), JSON.stringify({ base, account: email, pages, scenario }, null, 2))
    failed = Boolean(scenario?.error) || pages.some((page) => page.pageErrors.length > 0)
    log(`Report: ${join(outDir, 'report.json')}`)
} finally {
    await browser.close()
    if (!options.keep) for (const child of [server, engine]) if (child) process.kill(-child.pid)
}
process.exit(failed ? 1 : 0)
