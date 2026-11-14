import type { Usage } from '@rerun/contracts'

export type LiveSnapshot = { toolCalls: number; usage?: Partial<Usage> }

export type LiveCounter = {
    addToolCall(): void
    setUsage(partial: Partial<Usage>): void
    snapshot(): LiveSnapshot
    flushNow(): Promise<void>
    dispose(): void
}

type Options = { flush: (snapshot: LiveSnapshot) => Promise<void>; minIntervalMs?: number }

export function createLiveCounter({ flush, minIntervalMs = 2000 }: Options): LiveCounter {
    let toolCalls = 0
    let usage: Partial<Usage> | undefined
    let timer: ReturnType<typeof setTimeout> | null = null
    let lastFlushAt = Number.NEGATIVE_INFINITY
    let disposed = false

    const snapshot = (): LiveSnapshot => (usage ? { toolCalls, usage: { ...usage } } : { toolCalls })

    const run = async (): Promise<void> => {
        lastFlushAt = Date.now()
        try {
            await flush(snapshot())
        } catch {
        }
    }

    const schedule = (): void => {
        if (disposed || timer) return
        const wait = Math.max(0, lastFlushAt + minIntervalMs - Date.now())
        timer = setTimeout(() => {
            timer = null
            if (!disposed) void run()
        }, wait)
    }

    return {
        addToolCall() {
            toolCalls += 1
            schedule()
        },
        setUsage(partial) {
            usage = { ...usage, ...partial }
            schedule()
        },
        snapshot,
        async flushNow() {
            if (timer) {
                clearTimeout(timer)
                timer = null
            }
            await run()
        },
        dispose() {
            disposed = true
            if (timer) clearTimeout(timer)
            timer = null
        },
    }
}
