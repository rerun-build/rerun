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

import { writeFileSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
    PORT,
    REPO_ROOT,
    SHORT_VIEWPORT,
    VIEWPORTS,
    assertLocalProfile,
    assertMigrated,
    chromium,
    ensureServer,
    fail,
    linkTestEngine,
    localStack,
    log,
    markOnboarded,
    settle,
    signIn,
    slug,
    startEngine,
    testAccount,
    timings,
    watch,
} from './verify/shared.mjs'

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
const stack = localStack()
assertLocalProfile(stack)
assertMigrated()

const base = `http://localhost:${PORT}`
const outDir = join(REPO_ROOT, '.context/verify', new Date().toISOString().replace(/[:.]/g, '-'))
mkdirSync(outDir, { recursive: true })
const server = await ensureServer(base, outDir)

// Chromium's Local Network Access checks hold every request the page makes to the loopback stack
// (127.0.0.1:54421) and the dev server's HMR socket behind a permission prompt nobody answers.
const browser = await chromium.launch({ headless: !options.headed, args: ['--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests'] })
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
    const account = await testAccount(stack, options)
    await signIn(context, base, account)
    const engineLink = await linkTestEngine(account.admin, account.userId)
    if (options.onboarded) await markOnboarded(account.admin, engineLink.workspaceId)
    if (options.engine) engine = await startEngine(base, engineLink.apiKey, outDir)
    log(`Signed in as ${account.email}, workspace ${engineLink.workspaceId}.`)

    const pages = options.paths.length > 0 ? await capturePaths(context, base, options, outDir) : []
    const scenario = options.scenario ? await runScenario(context, base, options, outDir, { admin: account.admin, workspaceId: engineLink.workspaceId }) : null
    writeFileSync(join(outDir, 'report.json'), JSON.stringify({ base, account: account.email, pages, scenario }, null, 2))
    failed = Boolean(scenario?.error) || pages.some((page) => page.pageErrors.length > 0)
    log(`Report: ${join(outDir, 'report.json')}`)
} finally {
    await browser.close()
    if (!options.keep) for (const child of [server, engine]) if (child) process.kill(-child.pid)
}
process.exit(failed ? 1 : 0)
