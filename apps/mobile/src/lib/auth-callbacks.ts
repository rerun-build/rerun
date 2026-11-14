const AUTH_CALLBACKS = ['/auth/callback', '/oauth/callback']

export function isAuthCallback(path: string): boolean {
    const route = path.replace(/^[a-z+.-]+:\/\//i, '/').split(/[?#]/)[0]
    return AUTH_CALLBACKS.includes(route)
}
