export const PUBLISHED_AUTH_ROUTE = '/published-auth'

export function openPublishedHref(slug: string, next = '/'): string {
    const params = new URLSearchParams({ slug })
    if (next !== '/') params.set('next', next)
    return `${PUBLISHED_AUTH_ROUTE}?${params.toString()}`
}

export function publishedHostOf(url: string): string {
    try {
        const { host, pathname } = new URL(url)
        return pathname === '/' ? host : `${host}${pathname}`
    } catch {
        return url
    }
}
