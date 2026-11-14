export type ExpertSource = 'linkedin' | 'x'

export function normalizeProfileUrl(raw: string): string | null {
    const trimmed = raw.trim()
    if (!trimmed) return null
    const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
    try {
        return new URL(candidate).toString()
    } catch {
        return null
    }
}

export function detectExpertSource(url: string): ExpertSource | null {
    let host: string
    try {
        host = new URL(url).hostname.toLowerCase().replace(/^(www|mobile|m)\./, '')
    } catch {
        return null
    }
    if (host === 'linkedin.com' || host.endsWith('.linkedin.com')) return 'linkedin'
    if (host === 'x.com' || host === 'twitter.com') return 'x'
    return null
}
