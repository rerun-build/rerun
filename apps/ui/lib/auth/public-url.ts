import { requestHost } from '@/lib/request-host'

// Behind the proxy the request's own origin is the internal one.
export function publicUrl(request: Request, destination: string): string {
    const { origin } = new URL(request.url)
    if (process.env.NODE_ENV === 'development' || !request.headers.get('x-forwarded-host')) return `${origin}${destination}`
    return `https://${requestHost(request.headers)}${destination}`
}
