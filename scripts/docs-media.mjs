#!/usr/bin/env node
// Captures the screenshots and loops of the public docs (apps/docs/images) from the real app, on a
// demo workspace seeded for the purpose, so they can be taken again whenever a screen changes.
//
//   pnpm docs:media                       every scene
//   pnpm docs:media --only vault          the scenes of one docs page (repeatable)
//   pnpm docs:media --changed             the scenes whose watched files changed since origin/dev
//   pnpm docs:media --no-video            screenshots only (the loops need ffmpeg, or FFMPEG=<path>)
//   pnpm docs:media --list                the scenes and what they watch
//   pnpm docs:media --force               write every file again, even a screen that did not change
//
// Local stack only, like `pnpm verify:ui` (same checks): `pnpm db:start`, then `pnpm cloud env:local`.
// It signs in as `maya@acmestudio.example`, starts a local engine on a fresh data-dir, and seeds Acme
// Studio (scripts/docs-media/demo-workspace.mjs) without calling a model.
//
// A scene is a module of scripts/docs-media/scenes/ for one docs page:
//
//   export default {
//       page: 'vault',                                 // images land in apps/docs/images/vault/
//       watches: ['apps/ui/components/vault/'],        // what --changed looks at
//       view: 'board',                                 // or 'simple'
//       account: 'demo',                               // or 'onboarding', a workspace still on its welcome page (also per shot)
//       shots: [{ name, open: async ({ page, base, demo }) => …, frame: ({ page }) => locator, fit?: true }],
//       loops: [{ name, open, frame, play: async ({ page }) => …, hold?: ms }],
//   }
//
// `open` brings the screen up, `frame` returns the element to capture (`fit` lets a panel of fixed
// height shrink to its content), `play` is the gesture a loop records. Each shot is taken in light and dark at 1440 × 900, device scale 2, with the clock fixed
// to the demo's morning, so two runs give the same pictures.

import { execFileSync } from 'node:child_process'
import { readdirSync, rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
    ENGINE_PORT,
    PORT,
    REPO_ROOT,
    UI_DIR,
    assertLocalProfile,
    assertMigrated,
    chromium,
    ensureServer,
    fail,
    linkTestEngine,
    listeningPid,
    localStack,
    log,
    processCwd,
    signInPage,
    startEngine,
    testAccount,
    waitFor,
} from './verify/shared.mjs'
import { assertFfmpeg, captureScene } from './docs-media/capture.mjs'
import { COWORKERS, seedDemoWorkspace, seedOnboardingWorkspace } from './docs-media/demo-workspace.mjs'

const SCENES_DIR = join(REPO_ROOT, 'scripts/docs-media/scenes')
const DEMO_EMAIL = 'maya@acmestudio.example'
const ONBOARDING_EMAIL = 'leo@acmestudio.example'

function parseArgs(argv) {
    const options = { only: [], changed: false, video: true, force: false, list: false, keep: false, headed: false }
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]
        if (arg === '--only') options.only.push(argv[++i])
        else if (arg === '--changed') options.changed = true
        else if (arg === '--no-video') options.video = false
        else if (arg === '--force') options.force = true
        else if (arg === '--list') options.list = true
        else if (arg === '--keep') options.keep = true
        else if (arg === '--headed') options.headed = true
        else fail(`Unknown argument: ${arg}`)
    }
    return options
}

async function loadScenes() {
    const files = readdirSync(SCENES_DIR).filter((name) => name.endsWith('.mjs')).sort()
    return Promise.all(files.map(async (name) => ({ file: name, ...(await import(pathToFileURL(join(SCENES_DIR, name)).href)).default })))
}

function changedFiles() {
    const run = (args) => execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).split('\n').filter(Boolean)
    return [...new Set([...run(['diff', '--name-only', 'origin/dev...']), ...run(['diff', '--name-only', 'HEAD']), ...run(['ls-files', '--others', '--exclude-standard'])])]
}

function pickScenes(scenes, options) {
    let picked = scenes
    if (options.only.length) {
        picked = picked.filter((scene) => options.only.includes(scene.page))
        const unknown = options.only.filter((page) => !scenes.some((scene) => scene.page === page))
        if (unknown.length) fail(`No scene for ${unknown.join(', ')}. Scenes: ${scenes.map((scene) => scene.page).join(', ')}`)
    }
    if (options.changed) {
        const changed = changedFiles()
        const touches = (scene) => [`scripts/docs-media/scenes/${scene.file}`, 'scripts/docs-media/demo-workspace.mjs', ...(scene.watches ?? [])].some((watched) => changed.some((path) => path.startsWith(watched)))
        picked = picked.filter(touches)
    }
    return picked
}

// The engine of an interrupted run still holds the port and the data-dir: the run starts from a
// fresh data-dir, so it goes. One started from another worktree is left alone.
function stopLeftoverEngine() {
    const pid = listeningPid(ENGINE_PORT)
    if (!pid) return
    if (!processCwd(pid).startsWith(REPO_ROOT)) fail(`Port ${ENGINE_PORT} is held by a process of another worktree. Stop it or set CONDUCTOR_PORT.`)
    process.kill(Number(pid), 'SIGTERM')
    for (let waited = 0; listeningPid(ENGINE_PORT) && waited < 50; waited++) execFileSync('sleep', ['0.2'])
    log(`Stopped the engine a previous run left on port ${ENGINE_PORT}.`)
}

async function signedIn(browser, base, account) {
    const context = await browser.newContext()
    const page = await context.newPage()
    try {
        await signInPage(page, base, account)
    } catch (error) {
        const shot = join(workDir, `sign-in-${account.email}.png`)
        await page.screenshot({ path: shot }).catch(() => {})
        fail(`Could not sign in as ${account.email} (${page.url().replace(base, '')}), see ${shot}: ${error.message.split('\n')[0]}`)
    }
    const state = await context.storageState()
    await context.close()
    return state
}

const options = parseArgs(process.argv.slice(2))
const scenes = await loadScenes()

if (options.list) {
    for (const scene of scenes) console.log(`${scene.page}: ${(scene.shots ?? []).length} shots, ${(scene.loops ?? []).length} loops · watches ${(scene.watches ?? []).join(', ') || 'nothing'}`)
    process.exit(0)
}

const picked = pickScenes(scenes, options)
if (picked.length === 0) {
    log(options.changed ? 'No scene watches a file this branch changed: the docs media are up to date.' : 'No scene to capture.')
    process.exit(0)
}

if (options.video && picked.some((scene) => scene.loops?.length)) assertFfmpeg()
const stack = localStack()
assertLocalProfile(stack)
assertMigrated()

const base = `http://localhost:${PORT}`
const workDir = join(REPO_ROOT, '.context/docs-media', new Date().toISOString().replace(/[:.]/g, '-'))
const dataDir = join(REPO_ROOT, '.context/docs-media/engine-data')
mkdirSync(workDir, { recursive: true })
// A `next dev` cache left by another branch can serve a sign-in page that reloads itself forever:
// a hub this script starts begins from a clean one.
if (!listeningPid(PORT)) rmSync(join(UI_DIR, '.next/dev'), { recursive: true, force: true })
const server = await ensureServer(base, workDir)
// A hub left by an interrupted run may still be compiling.
await waitFor(`${base}/api/version`)

const browser = await chromium.launch({ headless: !options.headed, args: ['--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests'] })
let engine = null
// The hub and the engine write their logs through this process: left behind by a run that stopped
// on an error, they block on the closed pipe and the next run finds a hub that never answers.
process.on('exit', () => {
    if (options.keep) return
    for (const child of [server, engine]) {
        try {
            if (child) process.kill(-child.pid)
        } catch {}
    }
})
let failed = false
try {
    const account = await testAccount(stack, { fresh: false, email: DEMO_EMAIL })
    const storageState = await signedIn(browser, base, account)

    const engineLink = await linkTestEngine(account.admin, account.userId)
    stopLeftoverEngine()
    rmSync(dataDir, { recursive: true, force: true })
    engine = await startEngine(base, engineLink.apiKey, workDir, dataDir)
    const { engineIds } = await seedDemoWorkspace({ admin: account.admin, workspaceId: engineLink.workspaceId, userId: account.userId, email: account.email, apiKey: engineLink.apiKey, dataDir })
    const demo = { coworkers: COWORKERS, engineIds, workspaceId: engineLink.workspaceId }
    const states = { demo: storageState }

    if (picked.some((scene) => [scene, ...(scene.shots ?? []), ...(scene.loops ?? [])].some((item) => item.account === 'onboarding'))) {
        const newcomer = await testAccount(stack, { fresh: false, email: ONBOARDING_EMAIL })
        states.onboarding = await signedIn(browser, base, newcomer)
        const newcomerLink = await linkTestEngine(newcomer.admin, newcomer.userId)
        demo.onboarding = await seedOnboardingWorkspace({ admin: newcomer.admin, workspaceId: newcomerLink.workspaceId })
    }

    for (const scene of picked) {
        log(`Scene ${scene.page}`)
        try {
            await captureScene({ browser, base, states, scene, demo, workDir, video: options.video, force: options.force })
        } catch (error) {
            failed = true
            log(`Scene ${scene.page} failed: ${error?.message ?? error}`)
        }
    }
} finally {
    await browser.close()
}

log('Look at every picture before committing it: apps/docs/images/')
process.exit(failed ? 1 : 0)
