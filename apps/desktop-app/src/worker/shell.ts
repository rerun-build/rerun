import { spawn } from 'node:child_process'
import { OutputBuffer } from './output-buffer'
import { killTree } from './process-tree'

export type ShellSpec = { program: string; args: (command: string) => string[]; name: string }

// PowerShell on Windows, with its output forced to UTF-8 so "Vidéos été 2026" comes back as written.
// Elsewhere the person's own shell, so the aliases and the syntax they know are the ones a command uses.
export function shellFor(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): ShellSpec {
    if (platform === 'win32') {
        const utf8 = '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;$OutputEncoding=[System.Text.Encoding]::UTF8;$ProgressPreference="SilentlyContinue";'
        return { program: 'powershell.exe', args: command => ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', `${utf8}${command}`], name: 'powershell' }
    }
    const program = env.SHELL && /^\/[\w./-]+$/.test(env.SHELL) ? env.SHELL : platform === 'darwin' ? '/bin/zsh' : '/bin/sh'
    return { program, args: command => ['-c', command], name: program.split('/').pop() ?? 'sh' }
}

export type RunResult = { exitCode: number | null; stdout: string; stderr: string; truncated: boolean; timedOut: boolean; durationMs: number }

export type RunOptions = { command: string; cwd: string; env: NodeJS.ProcessEnv; shell: ShellSpec; timeoutMs: number; signal?: AbortSignal; platform?: NodeJS.Platform }

// Runs one command to its end, or until its time limit or the abort, killing every process it started.
export function runCommand({ command, cwd, env, shell, timeoutMs, signal, platform = process.platform }: RunOptions): Promise<RunResult> {
    const started = Date.now()
    return new Promise((resolve, reject) => {
        const child = spawn(shell.program, shell.args(command), { cwd, env, detached: platform !== 'win32', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
        const stdout = new OutputBuffer()
        const stderr = new OutputBuffer()
        let timedOut = false
        child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
        child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
        const timer = setTimeout(() => {
            timedOut = true
            killTree(child, platform)
        }, timeoutMs)
        const onAbort = () => killTree(child, platform)
        signal?.addEventListener('abort', onAbort, { once: true })
        child.once('error', err => {
            clearTimeout(timer)
            signal?.removeEventListener('abort', onAbort)
            reject(err)
        })
        child.once('close', code => {
            clearTimeout(timer)
            signal?.removeEventListener('abort', onAbort)
            resolve({ exitCode: code, stdout: stdout.text(), stderr: stderr.text(), truncated: stdout.truncated || stderr.truncated, timedOut, durationMs: Date.now() - started })
        })
    })
}
