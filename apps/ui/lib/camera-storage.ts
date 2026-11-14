import { z } from 'zod'

const cameraSchema = z.object({
    pan: z.object({ x: z.number().finite(), y: z.number().finite() }),
    zoom: z.number().min(0.3).max(3),
})

export type Camera = z.infer<typeof cameraSchema>

const keyFor = (scope: string) => `rerun:camera:${scope}`

const THROTTLE_MS = 250

let pending: { scope: string; camera: Camera } | null = null
let timer: ReturnType<typeof setTimeout> | null = null
let lastWriteAt = 0
let flushBound = false

function commit(): void {
    timer = null
    if (!pending) return
    const { scope, camera } = pending
    pending = null
    lastWriteAt = Date.now()
    try {
        localStorage.setItem(keyFor(scope), JSON.stringify(camera))
    } catch {
    }
}

export function writeCamera(scope: string, camera: Camera): void {
    if (!flushBound && typeof window !== 'undefined') {
        flushBound = true
        window.addEventListener('pagehide', flushCamera)
    }
    pending = { scope, camera }
    if (timer) return
    const elapsed = Date.now() - lastWriteAt
    if (elapsed >= THROTTLE_MS) {
        commit()
        return
    }
    timer = setTimeout(commit, THROTTLE_MS - elapsed)
}

export function flushCamera(): void {
    if (timer) clearTimeout(timer)
    commit()
}

export function readCamera(scope: string | null): Camera | null {
    if (!scope) return null
    try {
        const raw = localStorage.getItem(keyFor(scope))
        if (!raw) return null
        const parsed = cameraSchema.safeParse(JSON.parse(raw))
        if (parsed.success) return parsed.data
        localStorage.removeItem(keyFor(scope))
        return null
    } catch {
        return null
    }
}
