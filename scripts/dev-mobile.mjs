#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { apiAnswers, startApi, waitForApi, waitForMetro } from './dev-mobile-shared.mjs'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const APP_DIR = join(REPO_ROOT, 'apps/mobile')
const IOS_DIR = join(APP_DIR, 'ios')
const DERIVED_DATA_DIR = join(APP_DIR, '.expo/xcode-build')
const PREBUILD_STAMP = join(DERIVED_DATA_DIR, '.rerun-prebuild-stamp')
const TEAM_STAMP = join(DERIVED_DATA_DIR, '.rerun-apple-team')
const NATIVE_INPUTS = ['package.json', 'app.json', 'app.config.ts']
const CLIENT_CACHE_DIR = join(homedir(), 'Library/Caches/rerun-mobile')
const INSTALLED_DIR = join(CLIENT_CACHE_DIR, 'installed')
const CLIENT_KEY = /^[0-9a-f]{64}$/
const KEPT_CLIENTS = 4
const STALE_COPY_MS = 60 * 60_000
const SIMULATOR_PREFIX = 'Rerun · '
const SIMULATOR_TYPE = 'com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro'
const WORKSPACE_NAME = process.env.CONDUCTOR_WORKSPACE_NAME || basename(REPO_ROOT)
const API_PORT = Number(process.env.CONDUCTOR_PORT ?? 3050)
const METRO_PORT = API_PORT + 2
const onDevice = process.argv.includes('--device')
const onAndroid = process.argv.includes('--android')
const forceRebuild = process.argv.includes('--rebuild')

function dotenvValue(key) {
    const dotenv = existsSync(join(APP_DIR, '.env')) ? readFileSync(join(APP_DIR, '.env'), 'utf8') : ''
    return dotenv.match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1]?.trim() ?? ''
}

const remoteApiUrl = process.env.EXPO_PUBLIC_API_URL || dotenvValue('EXPO_PUBLIC_API_URL')
const usesLocalApi = !remoteApiUrl

function apiUrl() {
    if (!usesLocalApi) return remoteApiUrl
    if (!onDevice) return `http://localhost:${API_PORT}`
    const lanIp = spawnSync('ipconfig', ['getifaddr', 'en0'], { encoding: 'utf8' }).stdout?.trim()
    return `http://${lanIp || 'localhost'}:${API_PORT}`
}

const env = { ...process.env, PATH: `/opt/homebrew/bin:${process.env.PATH}`, EXPO_NO_GIT_STATUS: '1', RERUN_PERSONAL_TEAM: '1', EXPO_PUBLIC_API_URL: apiUrl() }

function log(message) {
    console.log(`[mobile] ${message}`)
}

function fail(message) {
    log(message)
    process.exit(1)
}

function runOrExit(command, args, options = {}) {
    const result = spawnSync(command, args, { stdio: 'inherit', env, cwd: APP_DIR, ...options })
    if (result.status !== 0) {
        log(`\`${command} ${args.join(' ')}\` failed`)
        process.exit(result.status ?? 1)
    }
}

const QUIET_WARNINGS = ['GCC_WARN_INHIBIT_ALL_WARNINGS=YES', 'SWIFT_SUPPRESS_WARNINGS=YES']

const BUILD_CACHE = ['COMPILATION_CACHE_ENABLE_CACHING=YES']

function runBuild(args) {
    return new Promise(done => {
        const startedAt = Date.now()
        const minutes = () => Math.round((Date.now() - startedAt) / 60_000)
        const heartbeat = setInterval(() => log(`still compiling, ${minutes()} min in`), 60_000)
        const build = spawn('xcodebuild', args, { stdio: 'inherit', env, cwd: APP_DIR })
        build.on('exit', code => {
            clearInterval(heartbeat)
            if (code !== 0) fail('`xcodebuild` failed, the error is above')
            log(`built in ${minutes()} min`)
            done()
        })
    })
}

function capture(command, args) {
    return spawnSync(command, args, { encoding: 'utf8', env }).stdout ?? ''
}

function devicectlJson(args) {
    const output = join(tmpdir(), `rerun-devicectl-${process.pid}.json`)
    spawnSync('xcrun', ['devicectl', ...args, '--quiet', '--json-output', output], { stdio: 'ignore', env })
    if (!existsSync(output)) return null
    const json = JSON.parse(readFileSync(output, 'utf8'))
    rmSync(output)
    return json.result
}

function readBundleId() {
    const config = JSON.parse(capture('pnpm', ['--dir', APP_DIR, 'exec', 'expo', 'config', '--type', 'public', '--json']))
    return config.ios.bundleIdentifier
}

function availableSimulators() {
    const { devices } = JSON.parse(capture('xcrun', ['simctl', 'list', 'devices', 'available', '--json']))
    return Object.values(devices).flat()
}

function latestIosRuntime() {
    const { runtimes } = JSON.parse(capture('xcrun', ['simctl', 'list', 'runtimes', '--json']))
    const iosRuntimes = runtimes
        .filter(runtime => runtime.platform === 'iOS' && runtime.isAvailable)
        .sort((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true }))
    if (!iosRuntimes.length) fail('no iOS simulator runtime installed, add one with `xcodebuild -downloadPlatform iOS`')
    return iosRuntimes.at(-1).identifier
}

function deleteArchivedWorkspaceSimulators() {
    const workspacePath = process.env.CONDUCTOR_WORKSPACE_PATH
    if (!workspacePath) return
    for (const simulator of availableSimulators()) {
        if (!simulator.name.startsWith(SIMULATOR_PREFIX)) continue
        const workspace = simulator.name.slice(SIMULATOR_PREFIX.length)
        if (existsSync(join(dirname(workspacePath), workspace))) continue
        log(`deleting the simulator of the archived workspace ${workspace}`)
        spawnSync('xcrun', ['simctl', 'shutdown', simulator.udid], { stdio: 'ignore' })
        spawnSync('xcrun', ['simctl', 'delete', simulator.udid], { stdio: 'ignore' })
        rmSync(join(INSTALLED_DIR, simulator.udid), { force: true })
    }
}

function workspaceSimulator() {
    const name = `${SIMULATOR_PREFIX}${WORKSPACE_NAME}`
    let simulator = availableSimulators().find(device => device.name === name)
    if (!simulator) {
        log(`creating the simulator "${name}"`)
        const udid = capture('xcrun', ['simctl', 'create', name, SIMULATOR_TYPE, latestIosRuntime()]).trim()
        if (!udid) fail(`could not create the simulator "${name}"`)
        log('setting it up, its first boot takes a few minutes')
        runOrExit('xcrun', ['simctl', 'bootstatus', udid, '-b'], { stdio: 'ignore' })
        runOrExit('xcrun', ['simctl', 'shutdown', udid])
        simulator = { name, udid, state: 'Shutdown' }
    }
    if (simulator.state !== 'Booted') log(`booting ${name}`)
    runOrExit('xcrun', ['simctl', 'bootstatus', simulator.udid, '-b'], { stdio: 'ignore' })
    return { name, udid: simulator.udid }
}

function pickPhone() {
    const phones = (devicectlJson(['list', 'devices'])?.devices ?? []).filter(
        device => device.hardwareProperties?.platform === 'iOS' && device.hardwareProperties?.reality === 'physical' && device.connectionProperties?.pairingState === 'paired',
    )
    const phone = phones.find(device => device.connectionProperties?.tunnelState === 'connected') ?? phones[0]
    if (!phone) fail('no paired iPhone, plug it in and accept "Trust This Computer"')
    const name = phone.deviceProperties.name
    const details = devicectlJson(['device', 'info', 'details', '--device', phone.identifier])
    if (!details) fail(`${name} does not answer, unlock it and keep it on the same Wi-Fi as this Mac (or plug it in)`)
    if (details.deviceProperties?.developerModeStatus !== 'enabled') {
        fail(`Developer Mode is off on ${name}: Settings > Privacy & Security > Developer Mode, then restart the phone`)
    }
    return { name, udid: phone.hardwareProperties.udid, coreDeviceId: phone.identifier }
}

function pickTeamId() {
    const remembered = existsSync(TEAM_STAMP) ? readFileSync(TEAM_STAMP, 'utf8').trim() : ''
    const teamId = process.env.RERUN_APPLE_TEAM_ID || remembered || teamFromXcodeCache() || teamFromProject() || teamFromCertificate()
    if (!teamId) {
        spawnSync('open', [join(IOS_DIR, 'Rerun.xcworkspace')], { stdio: 'ignore' })
        fail(
            'no Apple team found yet. In the Xcode window that just opened: Rerun target > Signing & Capabilities > Team > "<your name> (Personal Team)", then run this again',
        )
    }
    mkdirSync(DERIVED_DATA_DIR, { recursive: true })
    writeFileSync(TEAM_STAMP, teamId)
    return teamId
}

function teamFromXcodeCache() {
    const raw = capture('plutil', ['-extract', 'IDEProvisioningTeamByIdentifier', 'json', '-o', '-', join(process.env.HOME, 'Library/Preferences/com.apple.dt.Xcode.plist')])
    const teams = raw ? Object.values(JSON.parse(raw)).flat() : []
    return (teams.find(team => team.isFreeProvisioningTeam) ?? teams[0])?.teamID
}

function teamFromProject() {
    const project = join(IOS_DIR, 'Rerun.xcodeproj/project.pbxproj')
    return existsSync(project) ? readFileSync(project, 'utf8').match(/DEVELOPMENT_TEAM = "?(\w{10})"?;/)?.[1] : undefined
}

function teamFromCertificate() {
    const certificate = capture('security', ['find-certificate', '-c', 'Apple Development', '-p'])
    if (!certificate) return undefined
    const subject = spawnSync('openssl', ['x509', '-noout', '-subject'], { input: certificate, encoding: 'utf8' }).stdout ?? ''
    return subject.match(/OU\s*=\s*(\w{10})/)?.[1]
}

function lanAddress() {
    for (const iface of ['en0', 'en1']) {
        const address = capture('ipconfig', ['getifaddr', iface]).trim()
        if (address) return address
    }
    return 'localhost'
}

function nativeInputsHash() {
    const hash = createHash('sha256')
    for (const file of NATIVE_INPUTS) hash.update(readFileSync(join(APP_DIR, file)))
    return hash.digest('hex')
}

function clientKey({ sdk, bundleId, teamId }) {
    return createHash('sha256')
        .update(nativeInputsHash())
        .update([sdk, bundleId, teamId ?? ''].join('|'))
        .update(capture('xcodebuild', ['-version']))
        .digest('hex')
}

function storeClient(builtApp, entry) {
    const copy = `${entry}.tmp-${process.pid}`
    rmSync(copy, { recursive: true, force: true })
    runOrExit('ditto', [builtApp, join(copy, 'Rerun.app')])
    if (forceRebuild) rmSync(entry, { recursive: true, force: true })
    try {
        renameSync(copy, entry)
    } catch {
        rmSync(copy, { recursive: true, force: true })
    }
}

function pruneClients() {
    const entries = readdirSync(CLIENT_CACHE_DIR).map(name => ({ name, path: join(CLIENT_CACHE_DIR, name), modifiedAt: statSync(join(CLIENT_CACHE_DIR, name)).mtimeMs }))
    const staleCopies = entries.filter(entry => entry.name.includes('.tmp-') && Date.now() - entry.modifiedAt > STALE_COPY_MS)
    const oldClients = entries
        .filter(entry => CLIENT_KEY.test(entry.name))
        .sort((a, b) => b.modifiedAt - a.modifiedAt)
        .slice(KEPT_CLIENTS)
    for (const entry of [...staleCopies, ...oldClients]) rmSync(entry.path, { recursive: true, force: true })
}

if (onAndroid) {
    const { runAndroid } = await import('./dev-mobile-android.mjs')
    await runAndroid()
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => process.exit(130))
}

if (usesLocalApi) {
    if (await apiAnswers(API_PORT, 3_000)) log(`reusing the API already served on port ${API_PORT}`)
    else startApi({ port: API_PORT, cwd: REPO_ROOT, log })
} else {
    log(`the app talks to ${remoteApiUrl}`)
}

if (!onDevice) deleteArchivedWorkspaceSimulators()
const target = onDevice ? pickPhone() : workspaceSimulator()
const teamId = onDevice ? pickTeamId() : null
const sdk = onDevice ? 'iphoneos' : 'iphonesimulator'
const builtApp = join(DERIVED_DATA_DIR, `Build/Products/Debug-${sdk}/Rerun.app`)

if (!onDevice) spawnSync('open', ['-a', 'Simulator'], { stdio: 'ignore' })

const inputsHash = nativeInputsHash()
const prebuildIsCurrent = existsSync(PREBUILD_STAMP) && readFileSync(PREBUILD_STAMP, 'utf8') === inputsHash && existsSync(join(IOS_DIR, 'Rerun.xcworkspace'))
const bundleId = readBundleId()
const key = clientKey({ sdk, bundleId, teamId })
const clientEntry = join(CLIENT_CACHE_DIR, key)
const cachedApp = join(clientEntry, 'Rerun.app')
const reusesClient = !forceRebuild && existsSync(cachedApp)

if (reusesClient) {
    log(`reusing the dev client built for this native version (key ${key.slice(0, 8)})`)
    const now = new Date()
    utimesSync(clientEntry, now, now)
} else {
    if (!prebuildIsCurrent) {
        const clean = forceRebuild ? ['--clean'] : []
        log(`native inputs changed, running expo prebuild${clean.length ? ' --clean' : ''}`)
        runOrExit('pnpm', ['exec', 'expo', 'prebuild', '--platform', 'ios', ...clean])
        mkdirSync(DERIVED_DATA_DIR, { recursive: true })
        writeFileSync(PREBUILD_STAMP, inputsHash)
    }
    log(`building the dev client for ${target.name} (the first build takes a while)`)
    const signing = onDevice ? ['-allowProvisioningUpdates', '-allowProvisioningDeviceRegistration', `DEVELOPMENT_TEAM=${teamId}`, 'CODE_SIGN_STYLE=Automatic'] : []
    await runBuild([
        '-workspace', 'ios/Rerun.xcworkspace',
        '-scheme', 'Rerun',
        '-configuration', 'Debug',
        '-sdk', sdk,
        '-destination', `id=${target.udid}`,
        '-derivedDataPath', DERIVED_DATA_DIR,
        '-quiet',
        ...QUIET_WARNINGS,
        ...BUILD_CACHE,
        ...signing,
        'build',
    ])
    mkdirSync(CLIENT_CACHE_DIR, { recursive: true })
    storeClient(builtApp, clientEntry)
    pruneClients()
}

const installedMarker = join(INSTALLED_DIR, target.udid)
const installedKey = existsSync(installedMarker) ? readFileSync(installedMarker, 'utf8') : ''

if (onDevice) {
    log(`installing on ${target.name}`)
    runOrExit('xcrun', ['devicectl', 'device', 'install', 'app', '--device', target.coreDeviceId, cachedApp])
} else if (installedKey !== key || spawnSync('xcrun', ['simctl', 'get_app_container', target.udid, bundleId], { stdio: 'ignore' }).status !== 0) {
    log(`installing on ${target.name}`)
    runOrExit('xcrun', ['simctl', 'install', target.udid, cachedApp])
    mkdirSync(INSTALLED_DIR, { recursive: true })
    writeFileSync(installedMarker, key)
}

if (usesLocalApi) {
    log('waiting for the API to answer')
    if (await waitForApi(API_PORT)) log(`API ready, the app calls ${env.EXPO_PUBLIC_API_URL}`)
    else log(`the API does not answer on port ${API_PORT}, the app will show "Can't reach Rerun" until it does`)
}

log(`starting Metro on port ${METRO_PORT}`)
const metro = spawn('pnpm', ['exec', 'expo', 'start', '--dev-client', ...(onDevice ? ['--host', 'lan'] : []), '--port', String(METRO_PORT)], {
    stdio: 'inherit',
    env,
    cwd: APP_DIR,
})
metro.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)))
process.on('exit', () => metro.kill('SIGTERM'))

if (!(await waitForMetro(METRO_PORT))) {
    log(`Metro does not answer on port ${METRO_PORT}, open Rerun by hand once it does`)
} else if (onDevice) {
    const bundleUrl = `http://${lanAddress()}:${METRO_PORT}`
    const launch = spawnSync('xcrun', ['devicectl', 'device', 'process', 'launch', '--device', target.coreDeviceId, '--terminate-existing', '--payload-url', `exp+rerun://expo-development-client/?url=${encodeURIComponent(bundleUrl)}`, bundleId], { stdio: 'ignore', env })
    if (launch.status === 0) {
        log(`Rerun opened on ${target.name}, the phone must be on the same Wi-Fi as this Mac`)
    } else {
        log(`could not open Rerun on ${target.name}. A free Apple ID needs a one-time approval on the phone: Settings > General > VPN & Device Management > your Apple ID > Trust. Then open the app or scan the QR code`)
    }
} else {
    const launch = spawnSync('xcrun', ['simctl', 'launch', '--terminate-running-process', target.udid, bundleId, '--initialUrl', `http://localhost:${METRO_PORT}`], { stdio: 'ignore', env, timeout: 180_000 })
    if (launch.status === 0) log(`Rerun opened on ${target.name}`)
    else log(`could not open Rerun on ${target.name}, open it by hand in the simulator`)
}
