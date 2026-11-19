// Behind the proxy the request's own origin is the internal one.
export function publicUrl(request: Request, destination: string): string {
    const { origin } = new URL(request.url)
    const forwardedHost = request.headers.get('x-forwarded-host')
    if (process.env.NODE_ENV === 'development' || !forwardedHost) return `${origin}${destination}`
    return `https://${forwardedHost}${destination}`
}
