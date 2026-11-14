const PER_CALLER = { max: 20, windowMs: 5 * 60 * 1000 }
const EVERYONE = { max: 600, windowMs: 60 * 60 * 1000 }
const MAX_TRACKED_CALLERS = 5000

type Window = { startedAt: number; count: number }

export function createReadingLimiter(now: () => number = Date.now) {
    const callers = new Map<string, Window>()
    let everyone: Window = { startedAt: now(), count: 0 }

    function open(window: Window | undefined, windowMs: number): Window {
        return window && now() - window.startedAt < windowMs ? window : { startedAt: now(), count: 0 }
    }

    function forget() {
        for (const [caller, window] of callers) {
            if (now() - window.startedAt >= PER_CALLER.windowMs) callers.delete(caller)
        }
        if (callers.size >= MAX_TRACKED_CALLERS) callers.clear()
    }

    return function allow(caller: string): boolean {
        everyone = open(everyone, EVERYONE.windowMs)
        if (everyone.count >= EVERYONE.max) return false

        if (!callers.has(caller) && callers.size >= MAX_TRACKED_CALLERS) forget()
        const window = open(callers.get(caller), PER_CALLER.windowMs)
        callers.set(caller, window)
        if (window.count >= PER_CALLER.max) return false

        window.count += 1
        everyone.count += 1
        return true
    }
}
