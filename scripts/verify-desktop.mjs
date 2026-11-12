#!/usr/bin/env node
// Opens the desktop app (apps/desktop-app, Electron) on the hub of this workspace, signed in, and
// captures it, the way `pnpm verify:ui` does for the browser.
//
//   pnpm verify:desktop                                       the board, in both themes, at every size
//   pnpm verify:desktop --scenario .context/verify/flow.mjs   a scripted walk: clicks, typing, a capture per step
//   pnpm verify:desktop --signed-out                          a first launch, before any sign-in
//   pnpm verify:desktop --sizes 1440x900,820x640 --themes dark --native
//   pnpm verify:desktop --no-build                            reuses the last build of apps/desktop-app/out
//   pnpm verify:desktop --engine --scenario …                with a local engine behind the workspace
//   pnpm verify:desktop --packaged                            the packaged app (asar, fuses), as installed
//
// Local stack only, with the same checks as verify:ui (scripts/verify/shared.mjs). The app is the
// development channel ("Rerun Dev") pointed at the hub through RERUN_DESKTOP_URL, with a data folder
// of its own for the run, so nothing of an installed Rerun is read or touched.
//
// `--native` also captures the real window with macOS's `screencapture`, title bar and traffic lights
// included (the terminal needs the Screen Recording permission). Without it the captures are the
// page, as Playwright sees it.
//
// A scenario is a module whose default export receives
// `{ app, page, step, base, admin, workspaceId, account, outDir, shell }`: `app` is Playwright's
// ElectronApplication (`app.evaluate` runs in the main process), `page` the main window, `shell` a few
// helpers (resize the window, switch the system theme, read the window's state).
//
// Everything lands in `.context/verify/<timestamp>-desktop/`: the PNGs and a `report.json` with the
// console errors and the failed requests of every page.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
    PORT,
    REPO_ROOT,
    assertLocalProfile,
    assertMigrated,
    ensureServer,
    fail,
    linkTestEngine,
    localStack,
    log,
    markOnboarded,
    settle,
    signInPage,
    slug,
    startEngine,
    testAccount,
    watch,
} from './verify/shared.mjs'

const DESKTOP_DIR = join(REPO_ROOT, 'apps/desktop-app')
const fromDesktop = createRequire(join(DESKTOP_DIR, 'package.json'))
const { _electron: electron } = fromDesktop('playwright')

function parseArgs(argv) {
    const options = { sizes: ['1440x900', '1024x700', '820x640'], themes: ['light', 'dark'], scenario: null, signedOut: false, native: false, build: true, packaged: false, engine: false, keep: false, fresh: false, onboarded: false, paths: [] }
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]
        if (arg === '--sizes') options.sizes = argv[++i].split(',')
        else if (arg === '--themes') options.themes = argv[++i].split(',')
        else if (arg === '--scenario') options.scenario = resolve(argv[++i])
        else if (arg === '--signed-out') options.signedOut = true
        else if (arg === '--native') options.native = true
        else if (arg === '--no-build') options.build = false
        else if (arg === '--packaged') options.packaged = true
        else if (arg === '--engine') options.engine = true
        else if (arg === '--keep') options.keep = true
        else if (arg === '--fresh') options.fresh = true
        else if (arg === '--onboarded') options.onboarded = true
        else if (arg.startsWith('/')) options.paths.push(arg)
        else fail(`Unknown argument: ${arg}`)
    }
    for (const size of options.sizes) if (!/^\d+x\d+$/.test(size)) fail(`Size ${size} is not WIDTHxHEIGHT.`)
    if (options.paths.length === 0 && !options.scenario) options.paths.push('/')
    return options
}

// The packaged app is the development channel built with RERUN_DESKTOP_E2E=1: the same asar and fuses as
// a release, except the inspector fuse Playwright needs. Unsigned.
const PACKAGED_APP = join(DESKTOP_DIR, `release/dev/mac-${process.arch}/Rerun Dev.app/Contents/MacOS/Rerun Dev`)

function buildShell(packaged) {
    log(`Building apps/desktop-app (development channel${packaged ? ', packaged' : ''}).`)
    execFileSync('pnpm', ['--filter', '@rerun/contracts', 'build'], { cwd: REPO_ROOT, stdio: ['ignore', 'ignore', 'inherit'] })
    const env = { ...process.env, RERUN_DESKTOP_CHANNEL: 'dev', RERUN_DESKTOP_E2E: '1', CSC_IDENTITY_AUTO_DISCOVERY: 'false' }
    execFileSync('pnpm', ['run', packaged ? 'package:dir' : 'build'], { cwd: DESKTOP_DIR, stdio: ['ignore', 'ignore', 'inherit'], env })
}

async function launchShell(base, userData, packaged) {
    const app = await electron.launch({
        executablePath: packaged ? PACKAGED_APP : fromDesktop('electron'),
        args: packaged ? [] : [DESKTOP_DIR],
        cwd: DESKTOP_DIR,
        env: { ...process.env, RERUN_DESKTOP_URL: base, RERUN_DESKTOP_USER_DATA: userData },
        timeout: 60_000,
    })
    const page = await app.firstWindow()
    return { app, page }
}

function shellHelpers(app, page) {
    return {
        resize: (width, height) => app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)[0]?.setContentSize(size.width, size.height), { width, height }),
        setSystemTheme: (theme) => app.evaluate(({ nativeTheme }, value) => (nativeTheme.themeSource = value), theme),
        windowState: () => app.evaluate(({ BrowserWindow }) => {
            const window = BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)[0]
            return window ? { visible: window.isVisible(), focused: window.isFocused(), fullscreen: window.isFullScreen(), bounds: window.getBounds(), url: window.webContents.getURL() } : null
        }),
        pid: app.process().pid,
        page,
    }
}

// The real window as macOS draws it (title bar, traffic lights), by its CGWindowID: the window
// helper is compiled once into the temporary folder.
const WINDOW_ID_HELPER = join(tmpdir(), 'rerun-verify-window-id')

function windowIds(pid) {
    if (!existsSync(WINDOW_ID_HELPER)) execFileSync('swiftc', ['-O', '-o', WINDOW_ID_HELPER, join(REPO_ROOT, 'scripts/verify/window-id.swift')], { stdio: 'ignore' })
    return execFileSync(WINDOW_ID_HELPER, [String(pid)], { encoding: 'utf8' }).trim().split('\n').filter(Boolean)
}

async function nativeCapture(shell, path) {
    try {
        const [windowId] = windowIds(shell.pid)
        if (!windowId) return null
        execFileSync('screencapture', ['-x', '-o', '-l', windowId, path], { stdio: 'ignore' })
        return path
    } catch (error) {
        log(`screencapture failed: ${error.message}`)
        return null
    }
}

async function captureViews(page, shell, base, options, outDir) {
    const results = []
    for (const path of options.paths) {
        for (const theme of options.themes) {
            await shell.setSystemTheme(theme)
            await page.evaluate((value) => localStorage.setItem('theme', value), theme).catch(() => {})
            for (const size of options.sizes) {
                const [width, height] = size.split('x').map(Number)
                const report = { path, theme, size, consoleErrors: [], pageErrors: [], failedRequests: [] }
                const stop = watch(page, report)
                await shell.resize(width, height)
                await page.goto(`${base}${path}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
                report.stillLoading = !(await settle(page))
                report.finalUrl = page.url().replace(base, '')
                report.horizontalOverflowPx = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth))
                const name = `${slug(path)}.${theme}.${size}`
                report.screenshot = join(outDir, `${name}.png`)
                await page.screenshot({ path: report.screenshot })
                if (options.native) report.nativeScreenshot = await nativeCapture(shell, join(outDir, `${name}.native.png`))
                stop()
                results.push(report)
                const flags = [report.stillLoading && 'STILL LOADING', report.horizontalOverflowPx && `overflow ${report.horizontalOverflowPx}px`, report.pageErrors.length && `${report.pageErrors.length} page errors`, report.consoleErrors.length && `${report.consoleErrors.length} console errors`].filter(Boolean)
                log(`${path} ${theme} ${size}${flags.length ? ` · ${flags.join(' · ')}` : ''}`)
            }
        }
    }
    return results
}

async function runScenario(context, options, outDir) {
    const { page, shell } = context
    const report = { scenario: options.scenario, steps: [], consoleErrors: [], pageErrors: [], failedRequests: [] }
    watch(page, report)
    let index = 0
    const step = async (name, { target = page } = {}) => {
        const settled = await settle(target).catch(() => false)
        const file = `scenario.${String(++index).padStart(2, '0')}.${slug(name)}`
        const screenshot = join(outDir, `${file}.png`)
        await target.screenshot({ path: screenshot })
        const nativeScreenshot = options.native ? await nativeCapture(shell, join(outDir, `${file}.native.png`)) : null
        report.steps.push({ name, url: target.url(), screenshot, nativeScreenshot, stillLoading: !settled, at: new Date().toISOString() })
        log(`step ${index}: ${name}${settled ? '' : ' · STILL LOADING'}`)
    }
    const { default: scenario } = await import(pathToFileURL(options.scenario).href)
    try {
        await scenario({ ...context, step, outDir })
    } catch (error) {
        report.error = String(error?.stack ?? error)
        await step('failure').catch(() => {})
        log(`Scenario failed: ${error?.message ?? error}`)
    }
    return report
}

const options = parseArgs(process.argv.slice(2))
const stack = localStack()
assertLocalProfile(stack)
assertMigrated()

const base = `http://localhost:${PORT}`
const outDir = join(REPO_ROOT, '.context/verify', `${new Date().toISOString().replace(/[:.]/g, '-')}-desktop`)
mkdirSync(outDir, { recursive: true })
const server = await ensureServer(base, outDir)
if (options.build) buildShell(options.packaged)

const { app, page } = await launchShell(base, join(outDir, 'user-data'), options.packaged)
app.process().stdout?.on('data', (chunk) => process.env.VERIFY_DESKTOP_VERBOSE && process.stdout.write(chunk))
const shell = shellHelpers(app, page)
let failed = false
let engine = null
try {
    const seed = { app, page, shell, base, admin: null, workspaceId: null, account: null }
    if (!options.signedOut) {
        const account = await testAccount(stack, options)
        await signInPage(page, base, account)
        const engineLink = await linkTestEngine(account.admin, account.userId)
        if (options.onboarded) await markOnboarded(account.admin, engineLink.workspaceId)
        if (options.engine) engine = await startEngine(base, engineLink.apiKey, outDir)
        Object.assign(seed, { admin: account.admin, workspaceId: engineLink.workspaceId, account })
        log(`Signed in as ${account.email}, workspace ${engineLink.workspaceId}.`)
    } else {
        Object.assign(seed, { admin: (await testAccount(stack, { fresh: false })).admin })
    }
    const views = options.paths.length > 0 && !options.scenario ? await captureViews(page, shell, base, options, outDir) : []
    const scenario = options.scenario ? await runScenario(seed, options, outDir) : null
    writeFileSync(join(outDir, 'report.json'), JSON.stringify({ base, views, scenario }, null, 2))
    failed = Boolean(scenario?.error) || views.some((view) => view.pageErrors.length > 0)
    log(`Report: ${join(outDir, 'report.json')}`)
} finally {
    await app.close().catch(() => {})
    if (!options.keep) for (const child of [server, engine]) if (child) process.kill(-child.pid)
}
process.exit(failed ? 1 : 0)
