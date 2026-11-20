export function refusalMessageOf(text: string): string {
    try {
        const body = JSON.parse(text) as { error?: { message?: unknown } | string; message?: unknown }
        const message = typeof body.error === 'string' ? body.error : (body.error?.message ?? body.message)
        if (typeof message === 'string' && message) return message
    } catch {
    }
    return text.trim()
}

export function refusalResponse(response: Response, text: string, message: string | null, source: string): Response {
    const headers = new Headers(response.headers)
    headers.delete('content-length')
    headers.delete('content-encoding')
    if (!message) return new Response(text, { status: response.status, statusText: response.statusText, headers })
    headers.set('content-type', 'application/json')
    const body = { type: 'error', error: { type: `${source}_error`, message, code: response.status, status: `${source.toUpperCase()}_ERROR` } }
    return new Response(JSON.stringify(body), { status: response.status, statusText: response.statusText, headers })
}
