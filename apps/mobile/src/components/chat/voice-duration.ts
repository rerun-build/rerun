export function formatVoiceDuration(ms: number): string {
    const total = Number.isFinite(ms) && ms > 0 ? Math.round(ms / 1000) : 0
    const minutes = Math.floor(total / 60)
    return `${minutes}:${String(total % 60).padStart(2, '0')}`
}
