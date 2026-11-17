import { spawn, type ChildProcess } from 'node:child_process'

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
