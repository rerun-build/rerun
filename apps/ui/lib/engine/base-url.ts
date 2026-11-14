import { ENGINE_DEFAULT_PORT } from './constants'

export function buildBaseUrl(host: string): string {
    const trimmed = host.trim().replace(/\/$/, '')
    if (/^https?:\/\//.test(trimmed)) return trimmed
    if (/:\d+$/.test(trimmed)) return `http://${trimmed}`
    return `http://${trimmed}:${ENGINE_DEFAULT_PORT}`
}
