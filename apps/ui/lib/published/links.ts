// How the app opens a published link for a member: through the round trip of /published-auth, which
// hands the page's host a ticket, so a member opens their workspace's pages whatever their access.
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
