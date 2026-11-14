import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, resolve } from 'node:path'
import { connect } from 'node:net'
import { fileURLToPath } from 'node:url'
import { readAgentConfig } from '../agents/loader.js'
import { desktopEnabled, env } from '../config/env.js'
import { holdDisplay } from '../tools/virtual-display.js'
import { inheritedEnv } from '../lib/child-env.js'
import { HttpError } from '../lib/errors.js'
import { logger } from '../lib/logger.js'
import { barConfig, dockConfig, openboxConfig } from './panels.js'

const VNC_BASE_PORT = 5900
const REQUIRED_BINARIES = ['openbox', 'x11vnc', 'xdotool']
const PANEL_BINARIES = ['tint2', 'curl']
export const SCREEN_CAPTURE_BINARY = 'maim'
const ASSETS_DIR = fileURLToPath(new URL('../../assets/desktop', import.meta.url))
const DEFAULT_DATA_DIRS = '/usr/local/share:/usr/share'
const IDLE_STOP_MS = 5 * 60_000
const DRIVER_QUIET_MS = 5_000
const VNC_READY_TIMEOUT_MS = 5_000
const VNC_READY_POLL_MS = 100
const KILL_GRACE_MS = 2_000
const PORT_FREE_TIMEOUT_MS = KILL_GRACE_MS + 500

export type Desktop = { display: string; vncPort: number }
type RunningDesktop = Desktop & { children: ChildProcess[]; releaseDisplay: () => void }
type Screen = { desktop: Promise<RunningDesktop> | null; viewers: number; drivers: number; lastDriverInput: number; holds: number; idleTimer: NodeJS.Timeout | null; dock: boolean }
export type DesktopOptions = { timeZone?: string }

const screens = new Map<string, Screen>()
const liveChildren = new Set<ChildProcess>()
let available = false
let computer = false
let exitHooked = false

export function onPath(binary: string): boolean {
    return (process.env.PATH ?? '').split(delimiter).some(dir => dir && existsSync(resolve(dir, binary)))
}

export function desktopAvailable(): boolean {
    available ||= desktopEnabled() && process.platform === 'linux' && REQUIRED_BINARIES.every(onPath)
    return available
}

export function computerAvailable(): boolean {
    computer ||= desktopAvailable() && onPath(SCREEN_CAPTURE_BINARY)
    return computer
}

export function desktopEnv(display: string): Record<string, string> {
    return { ...inheritedEnv(), DISPLAY: display, GTK_THEME: 'Adwaita:dark' }
}

function screenOf(agentId: string): Screen {
    let screen = screens.get(agentId)
    if (!screen) {
        screen = { desktop: null, viewers: 0, drivers: 0, lastDriverInput: 0, holds: 0, idleTimer: null, dock: false }
        screens.set(agentId, screen)
    }
    return screen
}

function forgetIfUnused(agentId: string): void {
    const screen = screens.get(agentId)
    if (screen && !screen.desktop && screen.viewers === 0 && screen.holds === 0) screens.delete(agentId)
}

function vncAnswers(port: number): Promise<boolean> {
    return new Promise(done => {
        const socket = connect(port, '127.0.0.1')
        socket.once('connect', () => {
            socket.destroy()
            done(true)
        })
        socket.once('error', () => done(false))
    })
}

async function settles(condition: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
    for (let waited = 0; waited <= timeoutMs; waited += VNC_READY_POLL_MS) {
        if (await condition()) return true
        await new Promise(next => setTimeout(next, VNC_READY_POLL_MS))
    }
    return false
}

async function waitForVnc(port: number): Promise<void> {
    if (!(await settles(() => vncAnswers(port), VNC_READY_TIMEOUT_MS))) throw new HttpError(503, 'The desktop did not start.')
}

function killChildrenOnExit(): void {
    if (exitHooked) return
    exitHooked = true
    process.once('exit', () => liveChildren.forEach(child => child.kill()))
}

const hasExited = (child: ChildProcess): boolean => child.exitCode !== null || child.signalCode !== null

function killAll(children: ChildProcess[]): void {
    for (const child of children) {
        liveChildren.delete(child)
        if (hasExited(child)) continue
        child.kill()
        const forceKill = setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS)
        forceKill.unref()
        child.once('exit', () => clearTimeout(forceKill))
    }
}

const displayNameOf = (agentId: string): Promise<string> =>
    readAgentConfig(agentId)
        .then(config => config.displayName?.trim() || config.name)
        .catch(() => agentId)

function writeConfig(name: string, content: string): string {
    const configDir = resolve(tmpdir(), 'rerun-desktop')
    mkdirSync(configDir, { recursive: true })
    const file = resolve(configDir, name)
    writeFileSync(file, content)
    return file
}

async function startPanels(agentId: string, display: string, timeZone?: string): Promise<ChildProcess[]> {
    const apiKey = env().RERUN_API_KEY
    const panelEnv = {
        ...desktopEnv(display),
        ...(apiKey ? { RERUN_API_KEY: apiKey } : {}),
        RERUN_DESKTOP_AGENT: agentId,
        RERUN_DESKTOP_AGENT_NAME: await displayNameOf(agentId),
        RERUN_DESKTOP_ENGINE: `http://127.0.0.1:${env().RERUN_PORT}`,
        ...(timeZone ? { TZ: timeZone } : {}),
    }
    const configs = [writeConfig('dock.tint2rc', dockConfig(resolve(ASSETS_DIR, 'icons'))), writeConfig('bar.tint2rc', barConfig())]
    return configs.map(config => spawn('tint2', ['-c', config], { stdio: 'ignore', env: panelEnv }))
}

async function start(agentId: string, { timeZone }: DesktopOptions): Promise<RunningDesktop> {
    const { display, release: releaseDisplay } = await holdDisplay(agentId)
    if (!display) {
        releaseDisplay()
        throw new HttpError(503, 'This box has no display.')
    }
    const vncPort = VNC_BASE_PORT + Number(/:(\d+)/.exec(display)?.[1] ?? 0)
    if (!(await settles(async () => !(await vncAnswers(vncPort)), PORT_FREE_TIMEOUT_MS))) {
        releaseDisplay()
        logger.warn({ agentId, vncPort }, 'desktop port already taken')
        throw new HttpError(503, 'The desktop did not start.')
    }
    const options = { stdio: 'ignore' as const, env: desktopEnv(display) }
    const themed = { ...options, env: { ...options.env, XDG_DATA_DIRS: `${ASSETS_DIR}:${process.env.XDG_DATA_DIRS || DEFAULT_DATA_DIRS}` } }
    if (onPath('hsetroot')) spawn('hsetroot', ['-cover', resolve(ASSETS_DIR, 'wallpaper.png')], options).once('error', () => {})
    const children = [
        spawn('openbox', ['--config-file', writeConfig('openbox.xml', openboxConfig())], themed),
        spawn('x11vnc', ['-display', display, '-localhost', '-rfbport', String(vncPort), '-forever', '-shared', '-nopw', '-quiet'], options),
    ]
    for (const child of children) {
        child.once('error', err => logger.warn({ err: String(err), agentId }, 'desktop process failed'))
        child.once('exit', () => {
            if (liveChildren.has(child)) void stopDesktop(agentId)
        })
        liveChildren.add(child)
    }
    const panels = PANEL_BINARIES.every(onPath) ? await startPanels(agentId, display, timeZone) : []
    for (const panel of panels) {
        panel.once('error', err => logger.warn({ err: String(err), agentId }, 'desktop panel failed'))
        panel.once('exit', () => {
            if (!liveChildren.has(panel)) return
            const screen = screens.get(agentId)
            if (screen) screen.dock = false
        })
        liveChildren.add(panel)
        children.push(panel)
    }
    screenOf(agentId).dock = panels.length > 0
    killChildrenOnExit()
    try {
        await waitForVnc(vncPort)
    } catch (err) {
        killAll(children)
        releaseDisplay()
        throw err
    }
    logger.info({ agentId, display, vncPort }, 'desktop started')
    return { display, vncPort, children, releaseDisplay }
}

function armIdleStop(agentId: string): void {
    const screen = screens.get(agentId)
    if (!screen) return
    if (screen.idleTimer) clearTimeout(screen.idleTimer)
    screen.idleTimer = null
    if (screen.viewers > 0 || screen.holds > 0) return
    if (!screen.desktop) return forgetIfUnused(agentId)
    screen.idleTimer = setTimeout(() => void stopDesktop(agentId), IDLE_STOP_MS)
    screen.idleTimer.unref()
}

export async function ensureDesktop(agentId: string, options: DesktopOptions = {}): Promise<Desktop> {
    if (!desktopAvailable()) throw new HttpError(501, 'This box has no desktop installed.')
    const screen = screenOf(agentId)
    screen.desktop ??= start(agentId, options).catch(err => {
        screen.desktop = null
        forgetIfUnused(agentId)
        throw err
    })
    const { display, vncPort } = await screen.desktop
    armIdleStop(agentId)
    return { display, vncPort }
}

export function trackDesktopChild(agentId: string, child: ChildProcess): void {
    void screens
        .get(agentId)
        ?.desktop?.then(running => {
            running.children.push(child)
            liveChildren.add(child)
        })
        .catch(() => {})
}

export async function stopDesktop(agentId: string): Promise<void> {
    const screen = screens.get(agentId)
    if (!screen) return
    const running = await screen.desktop?.catch(() => null)
    screen.desktop = null
    screen.dock = false
    if (screen.idleTimer) clearTimeout(screen.idleTimer)
    screen.idleTimer = null
    forgetIfUnused(agentId)
    if (!running) return
    killAll(running.children)
    running.releaseDisplay()
    logger.info({ agentId }, 'desktop stopped')
}

export function viewerJoined(agentId: string): void {
    screenOf(agentId).viewers++
    armIdleStop(agentId)
}

export function viewerLeft(agentId: string): void {
    const screen = screens.get(agentId)
    if (!screen) return
    screen.viewers = Math.max(0, screen.viewers - 1)
    armIdleStop(agentId)
}

export function driverJoined(agentId: string): void {
    screenOf(agentId).drivers++
}

export function driverLeft(agentId: string): void {
    const screen = screens.get(agentId)
    if (screen) screen.drivers = Math.max(0, screen.drivers - 1)
}

export function driverActed(agentId: string, now: number = Date.now()): void {
    const screen = screens.get(agentId)
    if (screen) screen.lastDriverInput = now
}

export function humanDriving(agentId: string, now: number = Date.now()): boolean {
    const screen = screens.get(agentId)
    return !!screen && screen.drivers > 0 && now - screen.lastDriverInput < DRIVER_QUIET_MS
}

export function holdDesktop(agentId: string): () => void {
    screenOf(agentId).holds++
    armIdleStop(agentId)
    let released = false
    return () => {
        if (released) return
        released = true
        const screen = screens.get(agentId)
        if (!screen) return
        screen.holds = Math.max(0, screen.holds - 1)
        armIdleStop(agentId)
    }
}

export function desktopViewerCount(): number {
    let viewers = 0
    for (const screen of screens.values()) viewers += screen.viewers
    return viewers
}

export const viewersOf = (agentId: string): number => screens.get(agentId)?.viewers ?? 0

export function runningDesktops(): Array<{ agentId: string; viewers: number; dock: boolean }> {
    return [...screens].filter(([, screen]) => screen.desktop !== null).map(([agentId, screen]) => ({ agentId, viewers: screen.viewers, dock: screen.dock }))
}
