const FAVICON_SERVICE = 'https://www.google.com/s2/favicons'

const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/

export function siteDomain(input: string): string | null {
    const trimmed = input.trim()
    if (!trimmed || /\s/.test(trimmed)) return null
    let host: string
    try {
        host = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`).hostname
    } catch {
        return null
    }
    host = host.toLowerCase().replace(/\.$/, '').replace(/^www\./, '')
    return HOSTNAME.test(host) ? host : null
}

export function faviconUrl(domain: string): string {
    return `${FAVICON_SERVICE}?sz=128&domain=${encodeURIComponent(domain)}`
}
