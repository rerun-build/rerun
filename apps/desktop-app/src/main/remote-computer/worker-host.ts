import { utilityProcess, type UtilityProcess } from 'electron'
import { appendFileSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { MainToWorker, WorkerToMain } from '../../shared/remote-worker'

const MAX_RESTART_DELAY_MS = 30_000
const LOG_LIMIT_BYTES = 1024 * 1024

// What the worker prints, kept in a file of its own: the first place to look when a computer stays
// offline on someone's machine.
function appendLog(path: string, text: string): void {
    try {
        mkdirSync(dirname(path), { recursive: true })
        if ((statSync(path, { throwIfNoEntry: false })?.size ?? 0) > LOG_LIMIT_BYTES) writeFileSync(path, '')
        appendFileSync(path, text)
    } catch {
        // A log that cannot be written is not worth stopping the worker for.
    }
}

// Keeps the computer's worker running: it is forked from the app's own files, restarted with a
// growing delay when it dies, and handed its state again each time it starts.
export class WorkerHost {
    private child: UtilityProcess | null = null
    private stopping = false
    private restarts = 0
    private restartTimer: NodeJS.Timeout | null = null

    constructor(
        private readonly initMessage: () => MainToWorker,
        private readonly onMessage: (message: WorkerToMain) => void,
        private readonly logPath: string,
    ) {}

    get running(): boolean {
        return this.child !== null
    }

    start(): void {
        if (this.child || this.restartTimer) return
        this.stopping = false
        const child = utilityProcess.fork(join(import.meta.dirname, 'worker.js'), [], { serviceName: 'Rerun Computer', stdio: 'pipe' })
        this.child = child
        const log = (chunk: Buffer) => appendLog(this.logPath, chunk.toString('utf8'))
        child.stdout?.on('data', log)
        child.stderr?.on('data', log)
        appendLog(this.logPath, `[${new Date().toISOString()}] worker started\n`)
        const startedAt = Date.now()
        child.on('message', (message: WorkerToMain) => {
            if (message.type === 'ready') child.postMessage(this.initMessage())
            else this.onMessage(message)
        })
        child.once('exit', code => {
            if (this.child === child) this.child = null
            if (this.stopping) return
            if (Date.now() - startedAt > 60_000) this.restarts = 0
            const delay = Math.min(MAX_RESTART_DELAY_MS, 1_000 * 2 ** this.restarts++)
            appendLog(this.logPath, `[${new Date().toISOString()}] worker exited (${code}), restarting in ${delay} ms\n`)
            this.restartTimer = setTimeout(() => {
                this.restartTimer = null
                this.start()
            }, delay)
        })
    }

    post(message: MainToWorker): void {
        this.child?.postMessage(message)
    }

    stop(): void {
        this.stopping = true
        if (this.restartTimer) clearTimeout(this.restartTimer)
        this.restartTimer = null
        const child = this.child
        this.child = null
        if (!child) return
        child.postMessage({ type: 'shutdown' } satisfies MainToWorker)
        const kill = setTimeout(() => child.kill(), 3_000)
        child.once('exit', () => clearTimeout(kill))
    }
}
