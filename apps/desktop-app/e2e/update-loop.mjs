#!/usr/bin/env node
// The whole update loop on this Mac, from an installed 0.0.1 to 0.0.2 served by a local feed:
//
//   CSC_NAME="Apple Development: …" node apps/desktop-app/e2e/update-loop.mjs
//
// Squirrel.Mac only swaps an app for one signed by the same certificate, so both builds are signed
// with the identity in CSC_NAME (any certificate of the keychain works; a release uses the Developer
// ID). Both are the development channel built for tests (inspector fuse on), arm64 or x64 only.
//
// 1. builds 0.0.1 and 0.0.2 with the feed at http://127.0.0.1:<port>/
// 2. serves 0.0.2's latest-mac.yml and zip, "installs" 0.0.1 in a temporary Applications folder
// 3. launches it: it finds 0.0.2, downloads it, the page hears `ready`
// 4. asks the page to install: the app quits, ShipIt swaps the bundle, the app comes back as 0.0.2

import { execFileSync } from 'node:child_process'
import { cpSync, createReadStream, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DESKTOP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(DESKTOP_DIR, 'package.json'))
const { _electron: electron } = require('playwright')
const ARCH = process.arch === 'arm64' ? 'arm64' : 'x64'
const HUB = `http://localhost:${process.env.CONDUCTOR_PORT ?? 3050}`

function log(message) {
    console.log(`[update-loop] ${message}`)
}

if (!process.env.CSC_NAME) {
    console.error('Set CSC_NAME to a code signing identity of the keychain (security find-identity -v -p codesigning).')
    process.exit(1)
}

const feedRoot = join(DESKTOP_DIR, 'release/update-loop')
rmSync(feedRoot, { recursive: true, force: true })

const server = createServer((request, response) => {
    const file = join(feedRoot, 'v2', decodeURIComponent(new URL(request.url, 'http://x').pathname))
    if (!file.startsWith(join(feedRoot, 'v2')) || !existsSync(file) || statSync(file).isDirectory()) {
        response.writeHead(404).end()
        return
    }
    log(`feed served ${request.url}`)
    response.writeHead(200, { 'content-length': statSync(file).size })
    createReadStream(file).pipe(response)
})
await new Promise((done) => server.listen(0, '127.0.0.1', done))
const feed = `http://127.0.0.1:${server.address().port}/`

function build(version) {
    log(`building ${version}`)
    const env = { ...process.env, RERUN_DESKTOP_CHANNEL: 'dev', RERUN_DESKTOP_E2E: '1', RERUN_DESKTOP_UPDATE_URL: feed }
    execFileSync('pnpm', ['exec', 'electron-vite', 'build'], { cwd: DESKTOP_DIR, env, stdio: ['ignore', 'ignore', 'inherit'] })
    execFileSync(
        'pnpm',
        ['exec', 'electron-builder', '--config', 'electron-builder.config.ts', '--publish', 'never', '--mac', 'zip', `--${ARCH}`, `-c.extraMetadata.version=${version}`, `-c.directories.output=release/update-loop/${version === '0.0.1' ? 'v1' : 'v2'}`],
        { cwd: DESKTOP_DIR, env, stdio: ['ignore', 'ignore', 'inherit'] },
    )
}

build('0.0.1')
build('0.0.2')

const applications = mkdtempSync(join(tmpdir(), 'rerun-update-loop-'))
const installed = join(applications, 'Rerun Dev.app')
cpSync(join(feedRoot, 'v1', `mac-${ARCH}`, 'Rerun Dev.app'), installed, { recursive: true, verbatimSymlinks: true })
const plistVersion = () => execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', join(installed, 'Contents/Info.plist')], { encoding: 'utf8' }).trim()
log(`installed ${plistVersion()} in ${applications}`)

const app = await electron.launch({
    executablePath: join(installed, 'Contents/MacOS/Rerun Dev'),
    env: { ...process.env, RERUN_DESKTOP_UPDATE_TEST: '1', RERUN_DESKTOP_URL: HUB, RERUN_DESKTOP_USER_DATA: join(applications, 'user-data') },
})
const page = await app.firstWindow()
await page.waitForLoadState('domcontentloaded')
const capabilities = await page.evaluate(() => window.rerunShell?.capabilities ?? [])
if (!capabilities.includes('update')) throw new Error(`The packaged app does not offer updates (${capabilities})`)

const deadline = Date.now() + 180_000
let state
while (Date.now() < deadline) {
    state = await page.evaluate(() => window.rerunShell.update.getState())
    if (state.status === 'ready' || state.status === 'error') break
    await new Promise((done) => setTimeout(done, 1000))
}
log(`update state: ${JSON.stringify(state)}`)
if (state?.status !== 'ready' || state.version !== '0.0.2') throw new Error('0.0.2 was not downloaded')

await page.evaluate(() => window.rerunShell.update.install()).catch(() => {})
await app.waitForEvent('close', { timeout: 60_000 }).catch(() => {})
// ShipIt swaps the bundle once the app has quit, then relaunches it.
const swapDeadline = Date.now() + 90_000
while (Date.now() < swapDeadline && plistVersion() !== '0.0.2') await new Promise((done) => setTimeout(done, 1000))
const after = plistVersion()
log(`installed version after the update: ${after}`)
try {
    execFileSync('pkill', ['-f', installed], { stdio: 'ignore' })
} catch {}
server.close()
if (after !== '0.0.2') {
    console.error(readFileSync(join(process.env.HOME, 'Library/Caches/build.rerun.desktop.dev.ShipIt/ShipIt_stderr.log'), 'utf8').slice(-2000))
    process.exit(1)
}
log('ok: 0.0.1 updated itself to 0.0.2')
