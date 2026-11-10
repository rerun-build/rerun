export { formatBytes } from '@rerun/i18n/format'

export function formatEta(ms: number): string {
    const seconds = Math.ceil(ms / 1000)
    if (seconds < 60) return `${seconds}s left`
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes}m left`
    return `${Math.floor(minutes / 60)}h left`
}
