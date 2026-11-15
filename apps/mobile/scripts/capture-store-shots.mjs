#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const MOBILE_DIR = join(REPO_ROOT, 'apps/mobile')
const OUT_DIR = join(REPO_ROOT, 'cloud/apps/admin/public/render-lab/app-store')
const WORKSPACE_NAME = process.env.CONDUCTOR_WORKSPACE_NAME || basename(REPO_ROOT)
const onIpad = process.argv.includes('--ipad')
const SIMULATOR_NAME = onIpad ? `Rerun · ${WORKSPACE_NAME} · iPad` : `Rerun · ${WORKSPACE_NAME}`
const IOS_OUT_DIR = onIpad ? join(OUT_DIR, 'ipad') : OUT_DIR
const APPEARANCES = ['light', 'dark']
const DEV_BUNDLE_ID = 'build.rerun.app.dev'
const IOS_BUNDLE_ID = process.env.RERUN_IOS_BUNDLE_ID ?? DEV_BUNDLE_ID
const METRO_URL = `http://localhost:${Number(process.env.CONDUCTOR_PORT ?? 3050) + 2}`
const LAUNCH_MS = 9000
const SETTLE_MS = 5000

const CAPTURES = [
    { id: 'home', url: 'rerun://lab-foreman?state=conversation' },
    { id: 'manager', over: 'rerun://lab-foreman?state=conversation', url: 'rerun://lab-chat?coworker=foreman&tabs=1&state=conversation' },
    { id: 'working', url: 'rerun://lab-chat?tabs=3&active=0&state=running' },
    { id: 'approval', url: 'rerun://lab-chat?tabs=3&active=1&state=approval' },
    { id: 'providers', over: 'rerun://lab-foreman?state=conversation', url: 'rerun://lab-providers?state=keys' },
]

function simctl(...args) {
    const result = spawnSync('xcrun', ['simctl', ...args], { encoding: 'utf8' })
    if (result.status !== 0) throw new Error(`simctl ${args[0]} failed: ${result.stderr.trim()}`)
    return result.stdout
}

function simulatorUdid() {
    const { devices } = JSON.parse(simctl('list', 'devices', '--json'))
    const device = Object.values(devices)
        .flat()
        .find(candidate => candidate.name === SIMULATOR_NAME && candidate.state === 'Booted')
    if (!device) throw new Error(`"${SIMULATOR_NAME}" is not booted, start it with pnpm dev:mobile`)
    return device.udid
}

const wait = ms => new Promise(done => setTimeout(done, ms))

async function openUrl(udid, url) {
    simctl('openurl', udid, url)
    await wait(1500)
    spawnSync('axe', ['tap', '--label', 'Open', '--udid', udid], { encoding: 'utf8' })
}

async function captureIos(captures) {
    const udid = simulatorUdid()

    simctl('status_bar', udid, 'override', '--time', '9:41', '--batteryState', 'discharging', '--batteryLevel', '100', '--cellularBars', '4', '--wifiBars', '3', '--dataNetwork', 'wifi')

    for (const appearance of APPEARANCES) {
        simctl('ui', udid, 'appearance', appearance)
        mkdirSync(join(IOS_OUT_DIR, appearance), { recursive: true })
        for (const capture of captures) {
            simctl('launch', '--terminate-running-process', udid, IOS_BUNDLE_ID, '--initialUrl', METRO_URL)
            await wait(LAUNCH_MS)
            if (capture.over) {
                await openUrl(udid, capture.over)
                await wait(SETTLE_MS)
            }
            await openUrl(udid, capture.url)
            await wait(SETTLE_MS)
            const file = join(IOS_OUT_DIR, appearance, `${capture.id}.png`)
            simctl('io', udid, 'screenshot', '--type=png', file)
            console.log(file)
        }
    }
}

const ANDROID_SERIAL = 'emulator-5554'
const ANDROID_OUT_DIR = join(OUT_DIR, 'android')
const ANDROID_READY_TIMEOUT_MS = 180_000
const ANDROID_FIRST_SCREEN_MS = 15_000
const ANDROID_SETTLE_MS = 10_000

function adb(...args) {
    const result = spawnSync('adb', ['-s', ANDROID_SERIAL, ...args], { encoding: args[0] === 'exec-out' ? 'buffer' : 'utf8', maxBuffer: 64 * 1024 * 1024 })
    if (result.status !== 0) throw new Error(`adb ${args.join(' ')} failed: ${String(result.stderr).trim()}`)
    return result.stdout
}

const demo = (command, ...extras) => adb('shell', 'am', 'broadcast', '-a', 'com.android.systemui.demo', '-e', 'command', command, ...extras)

function enterDemoMode() {
    adb('shell', 'settings', 'put', 'global', 'sysui_demo_allowed', '1')
    demo('enter')
    demo('clock', '-e', 'hhmm', '0941')
    demo('battery', '-e', 'level', '100', '-e', 'plugged', 'false')
    demo('network', '-e', 'wifi', 'show', '-e', 'level', '4')
    demo('network', '-e', 'mobile', 'hide')
    demo('notifications', '-e', 'visible', 'false')
}

const appStarted = () => adb('logcat', '-d', '-s', 'ReactNativeJS:I').includes('Running "main"')

async function waitForAppStart() {
    const deadline = Date.now() + ANDROID_READY_TIMEOUT_MS
    while (Date.now() < deadline) {
        if (appStarted()) return
        await wait(2000)
    }
    throw new Error(`the app did not start within ${ANDROID_READY_TIMEOUT_MS / 1000} s`)
}

const openAndroidUrl = url => adb('shell', 'am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', `'${url}'`, DEV_BUNDLE_ID)

async function captureAndroid(captures) {
    const devClientUrl = `exp+rerun://expo-development-client/?url=${encodeURIComponent(METRO_URL)}`
    enterDemoMode()
    try {
        for (const appearance of APPEARANCES) {
            adb('shell', 'cmd', 'uimode', 'night', appearance === 'dark' ? 'yes' : 'no')
            await wait(10_000)
            mkdirSync(join(ANDROID_OUT_DIR, appearance), { recursive: true })
            for (const capture of captures) {
                adb('shell', 'am', 'force-stop', DEV_BUNDLE_ID)
                adb('logcat', '-c')
                openAndroidUrl(devClientUrl)
                await waitForAppStart()
                await wait(ANDROID_FIRST_SCREEN_MS)
                if (capture.over) {
                    openAndroidUrl(capture.over)
                    await wait(SETTLE_MS)
                }
                openAndroidUrl(capture.url)
                await wait(ANDROID_SETTLE_MS)
                const file = join(ANDROID_OUT_DIR, appearance, `${capture.id}.png`)
                writeFileSync(file, adb('exec-out', 'screencap', '-p'))
                console.log(`android/${appearance}/${capture.id}.png`)
            }
        }
    } finally {
        demo('exit')
    }
}

function agentDevice(...args) {
    const result = spawnSync('npx', ['--yes', 'eas-cli@latest', 'simulator:exec', 'npx', 'agent-device@latest', ...args], { cwd: MOBILE_DIR, encoding: 'utf8' })
    if (result.status !== 0) throw new Error(`agent-device ${args.join(' ')} failed: ${(result.stderr || result.stdout).trim()}`)
    return result.stdout
}

async function openDuoUrl(url) {
    agentDevice('open', url, '--platform', 'ios')
    await wait(2000)
    spawnSync('npx', ['--yes', 'eas-cli@latest', 'simulator:exec', 'npx', 'agent-device@latest', 'press', 'label="Open"', '--timeout', '15000'], { cwd: MOBILE_DIR, encoding: 'utf8' })
}

const DUO_OUT_DIR = join(OUT_DIR, 'duo')
const DUO_SETTLE_MS = 12_000

async function captureDuo(captures) {
    spawnSync('npx', ['--yes', 'eas-cli@latest', 'simulator:exec', 'npx', 'agent-device@latest', 'fold', 'open'], { cwd: MOBILE_DIR, encoding: 'utf8' })
    agentDevice('orientation', 'landscape-right')
    agentDevice('settings', 'appearance', 'light')
    await wait(10_000)
    mkdirSync(join(DUO_OUT_DIR, 'light'), { recursive: true })
    for (const capture of captures) {
        if (capture.over) {
            await openDuoUrl(capture.over)
            await wait(SETTLE_MS)
        }
        await openDuoUrl(capture.url)
        await wait(DUO_SETTLE_MS)
        const file = join(DUO_OUT_DIR, 'light', `${capture.id}.png`)
        agentDevice('screenshot', file, '--pixel-density', '3', '--normalize-status-bar')
        console.log(file)
    }
}

const onAndroid = process.argv.includes('--android')
const onDuo = process.argv.includes('--duo')
const only = process.argv.slice(2).filter(arg => !arg.startsWith('--'))
const captures = only.length ? CAPTURES.filter(capture => only.includes(capture.id)) : CAPTURES

if (onAndroid) await captureAndroid(captures)
else if (onDuo) await captureDuo(captures)
else await captureIos(captures)
