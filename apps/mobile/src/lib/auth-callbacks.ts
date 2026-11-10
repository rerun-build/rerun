// The redirects an OAuth sign-in comes back on: the auth session that opened the browser reads them.
const AUTH_CALLBACKS = ['/auth/callback', '/oauth/callback']

export function isAuthCallback(path: string): boolean {
    const route = path.replace(/^[a-z+.-]+:\/\//i, '/').split(/[?#]/)[0]
    return AUTH_CALLBACKS.includes(route)
}
