import { execFile, spawn, type ChildProcess } from 'node:child_process'

const GRACE_MS = 3_000

// A command runs in a shell, which starts the program the person asked for: killing the shell alone
// leaves `ffmpeg` running. On macOS and Linux the child leads its own process group and the whole
// group is signalled; on Windows `taskkill /T` walks the tree.
export function killTree(child: ChildProcess, platform: NodeJS.Platform = process.platform): void {
    const pid = child.pid
    if (pid === undefined || child.exitCode !== null || child.signalCode !== null) return
    if (platform === 'win32') {
        spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => child.kill())
        return
    }
    const signal = (name: NodeJS.Signals) => {
        try {
            process.kill(-pid, name)
        } catch {
            child.kill(name)
        }
    }
    signal('SIGTERM')
    const hard = setTimeout(() => signal('SIGKILL'), GRACE_MS)
    hard.unref()
    child.once('exit', () => clearTimeout(hard))
}

// When the process holding a pid started, null when it is gone or the system would not say.
export function processStartedAt(pid: number, platform: NodeJS.Platform = process.platform): Promise<number | null> {
    const [program, args] =
        platform === 'win32' ? (['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${pid}).StartTime.ToUniversalTime().ToString('o')`]] as const) : (['ps', ['-o', 'lstart=', '-p', String(pid)]] as const)
    return new Promise(resolve => {
        execFile(program, [...args], { timeout: 5_000, windowsHide: true, encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } }, (err, stdout) => {
            const at = err ? Number.NaN : Date.parse(stdout.trim())
            resolve(Number.isFinite(at) ? at : null)
        })
    })
}
