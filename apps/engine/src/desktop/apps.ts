import { execFile, spawn } from 'node:child_process'
import type { DesktopApp } from '@rerun/contracts'
import { workspaceDir } from '../config/paths.js'
import { windowClassOf } from './panels.js'
import { desktopEnv, ensureDesktop, trackDesktopChild } from './session.js'
import { startTakeover } from './takeover.js'

const COMMANDS: Record<Exclude<DesktopApp, 'browser'>, { command: string; args: (root: string) => string[] }> = {
    files: { command: 'thunar', args: root => [root] },
    terminal: { command: 'xfce4-terminal', args: root => [`--working-directory=${root}`] },
}

function raiseExisting(windowClass: string, env: NodeJS.ProcessEnv): Promise<boolean> {
    return new Promise(done => {
        execFile('xdotool', ['search', '--onlyvisible', '--class', windowClass], { env }, (err, stdout) => {
            const window = stdout.trim().split('\n').filter(Boolean).pop()
            if (err || !window) return done(false)
            execFile('xdotool', ['windowactivate', window], { env }, failed => done(!failed))
        })
    })
}

export async function openDesktopApp(agentId: string, app: DesktopApp): Promise<void> {
    const { display } = await ensureDesktop(agentId)
    const env = desktopEnv(display)
    if (await raiseExisting(windowClassOf(app), env)) return
    if (app === 'browser') return startTakeover(agentId, undefined, { endWhenUnwatched: true })
    const { command, args } = COMMANDS[app]
    const root = workspaceDir(agentId)
    const child = spawn(command, args(root), { stdio: 'ignore', env, cwd: root })
    child.once('error', () => {})
    trackDesktopChild(agentId, child)
}
