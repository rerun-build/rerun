import { app, BrowserWindow, dialog, net, powerSaveBlocker, type MenuItemConstructorOptions } from 'electron'
import { arch, homedir, hostname } from 'node:os'
import { join } from 'node:path'
import { REMOTE_COMPUTER_TOKEN_PREFIX, type DesktopRemoteComputerState, type DesktopRemoteLinkInput, type RemoteCapability } from '@rerun/contracts'
import { IPC, IPC_EVENTS } from '../../shared/ipc-channels'
import type { WorkerLinkState, WorkerLocalSettings, WorkerToMain } from '../../shared/remote-worker'
import { shellPlatform } from '../identity'
import { handle } from '../ipc'
import { currentServer } from '../main-window'
import { t } from '../messages'
import { readSettings, updateSettings } from '../settings'
import { keychainAvailable, readLinks, removeLink, saveLink, tokenOf, workerLinks } from './links'
import { WorkerHost } from './worker-host'

// This computer as a pair of hands for the coworkers of the workspaces it is linked to. The main
// process keeps the tokens and the person's settings, the worker (`src/worker/`) the sockets and the
// commands. Linked, the app stays alive with its windows closed, on every system.

const LOCAL_CAPABILITIES: RemoteCapability[] = ['shell', 'files']

let linkStates = new Map<string, WorkerLinkState>()
let runningJobs = 0
let keepAwake: number | null = null
const listeners = new Set<() => void>()

function localSettings(): WorkerLocalSettings {
    const saved = readSettings().remoteComputer
    return { paused: saved?.paused ?? false, workDir: saved?.workDir ?? join(homedir(), 'Rerun'), capabilities: LOCAL_CAPABILITIES }
}

const host = new WorkerHost(
    () => ({ type: 'init', dataDir: join(app.getPath('userData'), 'computer'), appVersion: app.getVersion(), settings: localSettings(), links: workerLinks() }),
    message => receive(message),
)

function receive(message: WorkerToMain): void {
    if (message.type === 'state') linkStates = new Map(message.links.map(state => [state.computerId, state]))
    if (message.type === 'revoked') forget(message.computerId)
    if (message.type === 'busy') setRunningJobs(message.runningJobs)
    changed()
}

// A job keeps the computer from sleeping on its own; a closed lid still does, and the job goes on
// when it wakes.
function setRunningJobs(count: number): void {
    runningJobs = count
    if (count > 0 && keepAwake === null) keepAwake = powerSaveBlocker.start('prevent-app-suspension')
    if (count === 0 && keepAwake !== null) {
        powerSaveBlocker.stop(keepAwake)
        keepAwake = null
    }
}

function suggestedName(): string {
    const name = hostname()
        .replace(/\.(local|lan|home)$/i, '')
        .replace(/[-_]+/g, ' ')
        .trim()
    return (name || t('computer.defaultName')).slice(0, 100)
}

export function remoteComputerState(): DesktopRemoteComputerState {
    const settings = localSettings()
    const links = readLinks()
    return {
        links: links.map(link => {
            const live = linkStates.get(link.computerId)
            return {
                computerId: link.computerId,
                name: link.name,
                handle: link.handle,
                workspaceId: link.workspaceId,
                workspaceName: link.workspaceName,
                hubOrigin: link.hubOrigin,
                linkedAt: link.linkedAt,
                status: live?.status ?? 'connecting',
                ...(live?.error ? { error: live.error } : {}),
            }
        }),
        paused: settings.paused,
        workDir: settings.workDir,
        // The keychain is only asked about once a link needs it.
        secureStorage: links.length === 0 || (links.every(link => link.encrypted) && keychainAvailable()),
        runningJobs,
        machine: { hostname: hostname(), os: shellPlatform(), arch: arch(), suggestedName: suggestedName() },
    }
}

export function onRemoteComputerChange(listener: () => void): void {
    listeners.add(listener)
}

function changed(): void {
    const state = remoteComputerState()
    for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send(IPC_EVENTS.remoteComputerState, state)
    for (const listener of listeners) listener()
}

function syncWorker(): void {
    if (readLinks().length === 0) {
        host.stop()
        linkStates = new Map()
        return
    }
    if (!host.running) host.start()
    else host.post({ type: 'links', links: workerLinks() })
}

function forget(computerId: string): void {
    removeLink(computerId)
    linkStates.delete(computerId)
    syncWorker()
}

export function hasLinkedComputers(): boolean {
    return readLinks().length > 0
}

function link(input: DesktopRemoteLinkInput): DesktopRemoteComputerState {
    const origin = currentServer()
    if (!origin) throw new Error('No server')
    const token = String(input?.token ?? '')
    if (!token.startsWith(REMOTE_COMPUTER_TOKEN_PREFIX) || token.length > 200) throw new Error('Invalid token')
    const computer = input.computer
    saveLink(
        {
            computerId: String(computer.id).slice(0, 64),
            name: String(computer.name).slice(0, 100),
            handle: String(computer.handle).slice(0, 32),
            workspaceId: Number(input.workspaceId) || 0,
            workspaceName: String(input.workspaceName ?? '').slice(0, 100),
            hubOrigin: origin,
            linkedAt: new Date().toISOString(),
        },
        token,
    )
    syncWorker()
    changed()
    return remoteComputerState()
}

// Told to the hub first, so the workspace stops offering the computer; forgotten here whatever the
// hub says, so a person can always cut the link from the computer itself.
async function unlink(computerId: string): Promise<DesktopRemoteComputerState> {
    const stored = readLinks().find(link => link.computerId === computerId)
    if (stored) {
        const token = tokenOf(stored)
        if (token) {
            await net
                .fetch(`${stored.hubOrigin}/api/remote-computers/unlink`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) })
                .catch(err => console.warn('[computer] the hub was not told of the unlink', err))
        }
        forget(computerId)
    }
    changed()
    return remoteComputerState()
}

function setLocal(patch: { paused?: boolean; workDir?: string }): DesktopRemoteComputerState {
    const current = readSettings().remoteComputer ?? {}
    updateSettings({ remoteComputer: { ...current, ...patch } })
    host.post({ type: 'settings', settings: localSettings() })
    changed()
    return remoteComputerState()
}

export function setComputerPaused(paused: boolean): DesktopRemoteComputerState {
    return setLocal({ paused })
}

async function chooseWorkDir(window: BrowserWindow | null): Promise<DesktopRemoteComputerState> {
    const options = { title: t('computer.chooseFolder'), defaultPath: localSettings().workDir, properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[] }
    const picked = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
    if (picked.canceled || !picked.filePaths[0]) return remoteComputerState()
    return setLocal({ workDir: picked.filePaths[0] })
}

export function registerRemoteComputerHandlers(): void {
    handle(IPC.remoteComputerGetState, ['app'], () => remoteComputerState())
    handle(IPC.remoteComputerLink, ['app'], (_event, input: DesktopRemoteLinkInput) => link(input))
    handle(IPC.remoteComputerUnlink, ['app'], (_event, computerId: string) => unlink(String(computerId)))
    handle(IPC.remoteComputerSetPaused, ['app'], (_event, paused: boolean) => setComputerPaused(paused === true))
    handle(IPC.remoteComputerChooseWorkDir, ['app'], event => chooseWorkDir(BrowserWindow.fromWebContents(event.sender)))
}

export function startRemoteComputer(): void {
    syncWorker()
}

export function stopRemoteComputer(): void {
    host.stop()
    setRunningJobs(0)
}

// The computer's lines in the tray menu: how it is doing, and the pause.
export function remoteComputerTrayItems(): MenuItemConstructorOptions[] {
    if (readLinks().length === 0) return []
    const state = remoteComputerState()
    const online = state.links.some(link => link.status === 'online')
    const status = state.paused ? t('computer.trayPaused') : state.runningJobs > 0 ? t('computer.trayJobs', { count: state.runningJobs }) : online ? t('computer.trayOnline') : t('computer.trayOffline')
    return [
        { label: status, enabled: false },
        { label: state.paused ? t('computer.resume') : t('computer.pause'), click: () => setComputerPaused(!state.paused) },
        { type: 'separator' },
    ]
}
