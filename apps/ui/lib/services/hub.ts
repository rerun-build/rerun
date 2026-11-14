export function hubBaseUrl(): string {
    const explicit = process.env.RERUN_HUB_BASE_URL
    if (explicit) return explicit.replace(/\/$/, '')
    return 'http://localhost:3050'
}
