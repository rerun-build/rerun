// The Expo Android app in this workspace's own emulator, from a bare checkout to a running bundle.
//
//   pnpm dev:mobile --android             reusing a dev client already built for the same native inputs
//   pnpm dev:mobile --android --rebuild   ignore the cached dev client and force the native build
//
// Same shape as the iOS path of dev-mobile.mjs. Each workspace gets its own AVD, "Rerun_<workspace>"
// (a Pixel 9 on the latest Google APIs image, for Play Services: Google Sign-In and push), and only one
// emulator runs at a time on the Mac: starting this one shuts down the others. The emulator reaches the
// Mac's Metro and Next through `adb reverse`, so the app calls `localhost` like the iOS simulator.
// The debug APK only depends on the native inputs, the JS comes from Metro, so every build is kept in a
// cache shared by the workspaces of this Mac. As on iOS, the key leaves pnpm-lock.yaml out: a native
// module bumped through the lockfile alone needs --rebuild.
// The dev client installs as `build.rerun.app.dev` (RERUN_ANDROID_DEV_CLIENT, see app.config.ts),
// beside a store build.

import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { apiAnswers, createLogger, startApi, waitForApi, waitForMetro } from './dev-mobile-shared.mjs'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const APP_DIR = join(REPO_ROOT, 'apps/mobile')
const ANDROID_DIR = join(APP_DIR, 'android')
const PREBUILD_STAMP = join(APP_DIR, '.expo/android-prebuild-stamp')
const NATIVE_INPUTS = ['package.json', 'app.json', 'app.config.ts']
const CLIENT_CACHE_DIR = join(homedir(), 'Library/Caches/rerun-mobile/android')
const INSTALLED_DIR = join(CLIENT_CACHE_DIR, 'installed')
const CLIENT_KEY = /^[0-9a-f]{64}$/
const KEPT_CLIENTS = 4
const AVD_PREFIX = 'Rerun_'
const AVD_DEVICE = 'pixel_9'
const AVD_RAM_MB = 3072
// Named after the workspace's folder, the name the cleanup of archived workspaces compares against
// (a Conductor workspace's display name can differ from its folder).
const WORKSPACE_PATH = process.env.CONDUCTOR_WORKSPACE_PATH || process.env.ORCA_WORKTREE_PATH || REPO_ROOT
const avdNameOf = (folder) => `${AVD_PREFIX}${folder.replace(/[^A-Za-z0-9._-]/g, '_')}`
const AVD_NAME = avdNameOf(basename(WORKSPACE_PATH))
const API_PORT = Number(process.env.CONDUCTOR_PORT ?? 3050)
const METRO_PORT = API_PORT + 2
const PACKAGE = 'build.rerun.app.dev'
// The emulator of the Mac's single running AVD: the default console port, so its serial is stable.
const EMULATOR_PORT = 5554
const SERIAL = `emulator-${EMULATOR_PORT}`
// Only the emulator's ABI: a debug build for the four ABIs takes three times as long.
const ABI = 'arm64-v8a'

const { log, fail } = createLogger('android')
const forceRebuild = process.argv.includes('--rebuild')

function dotenvValue(key) {
    const dotenv = existsSync(join(APP_DIR, '.env')) ? readFileSync(join(APP_DIR, '.env'), 'utf8') : ''
    return dotenv.match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1]?.trim() ?? ''
}

const remoteApiUrl = process.env.EXPO_PUBLIC_API_URL || dotenvValue('EXPO_PUBLIC_API_URL')
const usesLocalApi = !remoteApiUrl

// A hub on the Mac given by URL (say, one already running on the staging database) is the emulator's
// localhost only through `adb reverse`, like the hub this script starts.
function macPortOf(url) {
    try {
        const { hostname, port, protocol } = new URL(url)
        if (hostname !== 'localhost' && hostname !== '127.0.0.1') return null
        return Number(port || (protocol === 'https:' ? 443 : 80))
    } catch {
        return null
    }
}

function javaHome() {
    if (process.env.JAVA_HOME) return process.env.JAVA_HOME
    const brewJdk = spawnSync('brew', ['--prefix', 'openjdk@17'], { encoding: 'utf8' }).stdout?.trim()
    const home = brewJdk && join(brewJdk, 'libexec/openjdk.jdk/Contents/Home')
    if (!home || !existsSync(home)) fail('no JDK 17: `brew install openjdk@17`, or set JAVA_HOME')
    return home
}

const ANDROID_HOME = process.env.ANDROID_HOME || join(homedir(), 'Library/Android/sdk')
if (!existsSync(ANDROID_HOME)) fail(`no Android SDK in ${ANDROID_HOME}: install the command line tools (\`brew install --cask android-commandlinetools\`) or set ANDROID_HOME`)

const CMDLINE_TOOLS = [join(ANDROID_HOME, 'cmdline-tools/latest/bin'), '/opt/homebrew/share/android-commandlinetools/cmdline-tools/latest/bin'].find(dir => existsSync(join(dir, 'avdmanager')))
if (!CMDLINE_TOOLS) fail('no avdmanager: `brew install --cask android-commandlinetools`')

const env = {
    ...process.env,
    JAVA_HOME: javaHome(),
    ANDROID_HOME,
    ANDROID_SDK_ROOT: ANDROID_HOME,
    PATH: [join(ANDROID_HOME, 'platform-tools'), join(ANDROID_HOME, 'emulator'), CMDLINE_TOOLS, '/opt/homebrew/bin', process.env.PATH].join(':'),
    EXPO_NO_GIT_STATUS: '1',
    RERUN_ANDROID_DEV_CLIENT: '1',
    EXPO_PUBLIC_API_URL: usesLocalApi ? `http://localhost:${API_PORT}` : remoteApiUrl,
}

function capture(command, args) {
    return spawnSync(command, args, { encoding: 'utf8', env }).stdout ?? ''
}

function runOrExit(command, args, options = {}) {
    const result = spawnSync(command, args, { stdio: 'inherit', env, cwd: APP_DIR, ...options })
    if (result.status !== 0) fail(`\`${command} ${args.join(' ')}\` failed`)
}

function adb(...args) {
    return spawnSync('adb', ['-s', SERIAL, ...args], { encoding: 'utf8', env })
}

// The newest Google APIs image installed for the Mac's ABI, which is what the AVD boots.
function systemImage() {
    const images = join(ANDROID_HOME, 'system-images')
    const levels = existsSync(images) ? readdirSync(images).filter(name => /^android-\d+$/.test(name)) : []
    const level = levels
        .filter(name => existsSync(join(images, name, 'google_apis', ABI)))
        .sort((a, b) => Number(a.split('-')[1]) - Number(b.split('-')[1]))
        .at(-1)
    if (!level) fail(`no Google APIs system image, add one with \`sdkmanager "system-images;android-36;google_apis;${ABI}"\``)
    return `system-images;${level};google_apis;${ABI}`
}

function avds() {
    return capture('emulator', ['-list-avds'])
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
}

// The AVDs of archived workspaces would keep their disk images (several GB each) forever.
function deleteArchivedWorkspaceAvds() {
    if (WORKSPACE_PATH === REPO_ROOT && !process.env.CONDUCTOR_WORKSPACE_PATH && !process.env.ORCA_WORKTREE_PATH) return
    const workspaces = new Set(readdirSync(dirname(WORKSPACE_PATH)).map(avdNameOf))
    for (const avd of avds()) {
        if (!avd.startsWith(AVD_PREFIX) || workspaces.has(avd)) continue
        log(`deleting the emulator of the archived workspace ${avd.slice(AVD_PREFIX.length)}`)
        spawnSync('avdmanager', ['delete', 'avd', '-n', avd], { stdio: 'ignore', env })
    }
}

function ensureAvd() {
    if (avds().includes(AVD_NAME)) return
    const image = systemImage()
    log(`creating the emulator "${AVD_NAME}" (${AVD_DEVICE}, ${image})`)
    const create = spawnSync('avdmanager', ['create', 'avd', '-n', AVD_NAME, '-k', image, '-d', AVD_DEVICE, '--force'], { input: 'no\n', encoding: 'utf8', env })
    if (create.status !== 0) fail(`could not create the emulator: ${create.stderr || create.stdout}`)
    const config = join(homedir(), '.android/avd', `${AVD_NAME}.avd`, 'config.ini')
    const settings = readFileSync(config, 'utf8')
        .replace(/^hw\.ramSize=.*$/m, '')
        .replace(/^hw\.keyboard=.*$/m, '')
        .replace(/^hw\.gpu\.enabled=.*$/m, '')
        .replace(/^hw\.gpu\.mode=.*$/m, '')
    writeFileSync(config, `${settings.trimEnd()}\nhw.ramSize=${AVD_RAM_MB}\nhw.keyboard=yes\nhw.gpu.enabled=yes\nhw.gpu.mode=host\n`)
}

function runningAvd() {
    const devices = capture('adb', ['devices'])
    if (!devices.includes(`${SERIAL}\tdevice`)) return null
    return adb('emu', 'avd', 'name').stdout.split('\n')[0].trim() || null
}

// One emulator at a time: each takes 3 to 4 GB, and the Mac also runs Docker and the iOS simulators.
function stopOtherEmulators() {
    for (const line of capture('adb', ['devices']).split('\n')) {
        const serial = line.split('\t')[0]
        if (!serial.startsWith('emulator-')) continue
        const name = spawnSync('adb', ['-s', serial, 'emu', 'avd', 'name'], { encoding: 'utf8', env }).stdout.split('\n')[0].trim()
        if (serial === SERIAL && name === AVD_NAME) continue
        log(`shutting down the emulator ${name || serial}`)
        spawnSync('adb', ['-s', serial, 'emu', 'kill'], { stdio: 'ignore', env })
    }
}

async function bootEmulator() {
    if (runningAvd() === AVD_NAME) return
    stopOtherEmulators()
    for (let attempt = 0; attempt < 30 && capture('adb', ['devices']).includes(SERIAL); attempt++) await new Promise(done => setTimeout(done, 1000))
    log(`booting ${AVD_NAME}`)
    const emulator = spawn('emulator', ['-avd', AVD_NAME, '-port', String(EMULATOR_PORT), '-no-boot-anim', '-netdelay', 'none', '-netspeed', 'full'], { env, detached: true, stdio: 'ignore' })
    emulator.unref()
    spawnSync('adb', ['-s', SERIAL, 'wait-for-device'], { env, timeout: 300_000 })
    const startedAt = Date.now()
    while (adb('shell', 'getprop', 'sys.boot_completed').stdout.trim() !== '1') {
        if (Date.now() - startedAt > 600_000) fail(`${AVD_NAME} did not finish booting in 10 minutes`)
        await new Promise(done => setTimeout(done, 2000))
    }
    log(`${AVD_NAME} is up`)
}

function nativeInputsHash() {
    const hash = createHash('sha256')
    for (const file of NATIVE_INPUTS) hash.update(readFileSync(join(APP_DIR, file)))
    return hash.digest('hex')
}

function clientKey() {
    const jdk = spawnSync(join(env.JAVA_HOME, 'bin/java'), ['-version'], { encoding: 'utf8' }).stderr ?? ''
    return createHash('sha256').update(nativeInputsHash()).update([PACKAGE, ABI, jdk].join('|')).digest('hex')
}

// A quiet gradle prints nothing for minutes on a cold build, so it gets a heartbeat.
function runGradle(args) {
    return new Promise(done => {
        const startedAt = Date.now()
        const minutes = () => Math.round((Date.now() - startedAt) / 60_000)
        const heartbeat = setInterval(() => log(`still compiling, ${minutes()} min in`), 60_000)
        const gradle = spawn('./gradlew', args, { stdio: 'inherit', env, cwd: ANDROID_DIR })
        gradle.on('exit', code => {
            clearInterval(heartbeat)
            if (code !== 0) fail('gradle failed, the error is above')
            log(`built in ${minutes()} min`)
            done()
        })
    })
}

function storeClient(apk, entry) {
    const copy = `${entry}.tmp-${process.pid}`
    rmSync(copy, { recursive: true, force: true })
    mkdirSync(copy, { recursive: true })
    copyFileSync(apk, join(copy, 'app-debug.apk'))
    if (forceRebuild) rmSync(entry, { recursive: true, force: true })
    try {
        renameSync(copy, entry)
    } catch {
        rmSync(copy, { recursive: true, force: true })
    }
}

function pruneClients() {
    const entries = readdirSync(CLIENT_CACHE_DIR)
        .filter(name => CLIENT_KEY.test(name))
        .map(name => ({ path: join(CLIENT_CACHE_DIR, name), modifiedAt: statSync(join(CLIENT_CACHE_DIR, name)).mtimeMs }))
        .sort((a, b) => b.modifiedAt - a.modifiedAt)
    for (const entry of entries.slice(KEPT_CLIENTS)) rmSync(entry.path, { recursive: true, force: true })
}

async function devClient() {
    const key = clientKey()
    const entry = join(CLIENT_CACHE_DIR, key)
    const apk = join(entry, 'app-debug.apk')
    if (!forceRebuild && existsSync(apk)) {
        log(`reusing the dev client built for this native version (key ${key.slice(0, 8)})`)
        const now = new Date()
        utimesSync(entry, now, now)
        return { key, apk }
    }
    const inputsHash = nativeInputsHash()
    const prebuildIsCurrent = existsSync(PREBUILD_STAMP) && readFileSync(PREBUILD_STAMP, 'utf8') === inputsHash && existsSync(join(ANDROID_DIR, 'gradlew'))
    if (!prebuildIsCurrent) {
        const clean = forceRebuild ? ['--clean'] : []
        log(`native inputs changed, running expo prebuild${clean.length ? ' --clean' : ''}`)
        runOrExit('pnpm', ['exec', 'expo', 'prebuild', '--platform', 'android', '--no-install', ...clean])
        mkdirSync(dirname(PREBUILD_STAMP), { recursive: true })
        writeFileSync(PREBUILD_STAMP, inputsHash)
    }
    log('building the dev client (the first build takes a while)')
    await runGradle(['assembleDebug', `-PreactNativeArchitectures=${ABI}`, '--quiet', '--console=plain'])
    mkdirSync(CLIENT_CACHE_DIR, { recursive: true })
    storeClient(join(ANDROID_DIR, 'app/build/outputs/apk/debug/app-debug.apk'), entry)
    pruneClients()
    return { key, apk }
}

function install({ key, apk }) {
    const marker = join(INSTALLED_DIR, AVD_NAME)
    const installedKey = existsSync(marker) ? readFileSync(marker, 'utf8') : ''
    const present = adb('shell', 'pm', 'path', PACKAGE).stdout.includes('package:')
    if (installedKey === key && present) return
    log(`installing on ${AVD_NAME}`)
    const result = adb('install', '-r', '-d', apk)
    if (result.status !== 0) fail(`adb install failed: ${result.stderr || result.stdout}`)
    mkdirSync(INSTALLED_DIR, { recursive: true })
    writeFileSync(marker, key)
}

export async function runAndroid() {
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => process.exit(130))

    if (usesLocalApi) {
        if (await apiAnswers(API_PORT, 3_000)) log(`reusing the API already served on port ${API_PORT}`)
        else startApi({ port: API_PORT, cwd: REPO_ROOT, log })
    } else {
        log(`the app talks to ${remoteApiUrl}`)
    }

    deleteArchivedWorkspaceAvds()
    ensureAvd()
    const client = await devClient()
    await bootEmulator()
    install(client)

    // The emulator's localhost is its own: these make the Mac's Metro and Next answer there.
    const apiPort = usesLocalApi ? API_PORT : macPortOf(remoteApiUrl)
    for (const port of [METRO_PORT, ...(apiPort ? [apiPort] : [])]) adb('reverse', `tcp:${port}`, `tcp:${port}`)

    if (usesLocalApi) {
        log('waiting for the API to answer')
        if (await waitForApi(API_PORT)) log(`API ready, the app calls ${env.EXPO_PUBLIC_API_URL}`)
        else log(`the API does not answer on port ${API_PORT}, the app will show "Can't reach Rerun" until it does`)
    }

    log(`starting Metro on port ${METRO_PORT}`)
    const metro = spawn('pnpm', ['exec', 'expo', 'start', '--dev-client', '--port', String(METRO_PORT)], { stdio: 'inherit', env, cwd: APP_DIR })
    metro.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)))
    process.on('exit', () => metro.kill('SIGTERM'))

    if (!(await waitForMetro(METRO_PORT))) {
        log(`Metro does not answer on port ${METRO_PORT}, open Rerun by hand once it does`)
    } else {
        const url = `exp+rerun://expo-development-client/?url=${encodeURIComponent(`http://localhost:${METRO_PORT}`)}`
        const launch = adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', `'${url}'`, PACKAGE)
        if (launch.status === 0) log(`Rerun opened on ${AVD_NAME}`)
        else log(`could not open Rerun on ${AVD_NAME}, open it by hand in the emulator`)
    }
    await new Promise(() => {})
}
