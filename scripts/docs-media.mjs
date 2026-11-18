#!/usr/bin/env node
// Captures the screenshots and loops of the public docs (apps/docs/images) from the real app, on a
// demo workspace seeded for the purpose, so they can be taken again whenever a screen changes.
//
//   pnpm docs:media                       every scene
//   pnpm docs:media --only vault          the scenes of one docs page (repeatable)
//   pnpm docs:media --changed             the scenes whose watched files changed since origin/dev
//   pnpm docs:media --no-video            screenshots only (the loops need ffmpeg, or FFMPEG=<path>)
//   pnpm docs:media --list                the scenes and what they watch
//
// Local stack only, like `pnpm verify:ui` (same checks): `pnpm db:start`, then `pnpm cloud env:local`.
// It signs in as `docs-demo@rerun.local`, starts a local engine on a fresh data-dir, and seeds Acme
// Studio (scripts/docs-media/demo-workspace.mjs) without calling a model.
//
// A scene is a module of scripts/docs-media/scenes/ for one docs page:
//
//   export default {
//       page: 'vault',                                 // images land in apps/docs/images/vault/
//       watches: ['apps/ui/components/vault/'],        // what --changed looks at
//       view: 'board',                                 // or 'simple'
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
} from './verify/shared.mjs'
import { assertFfmpeg, captureScene } from './docs-media/capture.mjs'
import { COWORKERS, seedDemoWorkspace } from './docs-media/demo-workspace.mjs'

const SCENES_DIR = join(REPO_ROOT, 'scripts/docs-media/scenes')
const DEMO_EMAIL = 'docs-demo@rerun.local'

function parseArgs(argv) {
    const options = { only: [], changed: false, video: true, list: false, keep: false, headed: false }
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]
        if (arg === '--only') options.only.push(argv[++i])
        else if (arg === '--changed') options.changed = true
        else if (arg === '--no-video') options.video = false
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
const server = await ensureServer(base, workDir)

const browser = await chromium.launch({ headless: !options.headed, args: ['--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests'] })
let engine = null
let failed = false
try {
    const account = await testAccount(stack, { fresh: false, email: DEMO_EMAIL })
    const signInContext = await browser.newContext()
    const signInTab = await signInContext.newPage()
    await signInPage(signInTab, base, account)
    const storageState = await signInContext.storageState()
    await signInContext.close()

    const engineLink = await linkTestEngine(account.admin, account.userId)
    stopLeftoverEngine()
    rmSync(dataDir, { recursive: true, force: true })
    engine = await startEngine(base, engineLink.apiKey, workDir, dataDir)
    const { engineIds } = await seedDemoWorkspace({ admin: account.admin, workspaceId: engineLink.workspaceId, userId: account.userId, apiKey: engineLink.apiKey, dataDir })
    const demo = { coworkers: COWORKERS, engineIds, workspaceId: engineLink.workspaceId }

    for (const scene of picked) {
        log(`Scene ${scene.page}`)
        try {
            await captureScene({ browser, base, storageState, scene, demo, workDir, video: options.video })
        } catch (error) {
            failed = true
            log(`Scene ${scene.page} failed: ${error?.message ?? error}`)
        }
    }
} finally {
    await browser.close()
    if (!options.keep) for (const child of [server, engine]) if (child) process.kill(-child.pid)
}

log('Look at every picture before committing it: apps/docs/images/')
process.exit(failed ? 1 : 0)
