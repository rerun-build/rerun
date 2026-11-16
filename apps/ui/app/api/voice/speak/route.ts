import { requireWorkspaceId } from '@/app/api/_auth/ownership'
import { CALL_VOICES, speechStream } from '@/lib/ai/speak'

export const runtime = 'nodejs'

// One sentence at a time: the call says an answer as it streams.
const MAX_TEXT_CHARS = 600

// Call prototype: a call asks for a sentence every second or two, and checking the caller costs a
// third of a second each time. A token that just passed is trusted for a minute, for this route only.
const CALLER_TRUST_MS = 60_000
const MAX_TRUSTED_CALLERS = 500
const trustedCallers = new Map<string, number>()

async function callerAllowed(request: Request): Promise<boolean> {
    const authorization = request.headers.get('authorization')
    const key = `${authorization}|${request.headers.get('x-workspace-id')}`
    if (authorization && (trustedCallers.get(key) ?? 0) > Date.now()) return true
    try {
        await requireWorkspaceId()
    } catch {
        return false
    }
    if (trustedCallers.size >= MAX_TRUSTED_CALLERS) trustedCallers.clear()
    if (authorization) trustedCallers.set(key, Date.now() + CALLER_TRUST_MS)
    return true
}

export async function GET(request: Request) {
    if (!(await callerAllowed(request))) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const params = new URL(request.url).searchParams
    const text = params.get('text')?.trim() ?? ''
    const voice = CALL_VOICES[params.get('voice') ?? '']
    const language = /^[a-z]{2}$/.test(params.get('lang') ?? '') ? params.get('lang') : null
    if (!text || text.length > MAX_TEXT_CHARS) return Response.json({ error: 'Missing or too long text' }, { status: 400 })
    if (!voice) return Response.json({ error: 'Unknown voice' }, { status: 400 })

    const startedAt = performance.now()
    try {
        const audio = await speechStream(text, voice, language, request.signal)
        console.log(`[SPEAK] provider=${voice.provider} chars=${text.length} firstByte=${Math.round(performance.now() - startedAt)}`)
        return new Response(audio, { headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' } })
    } catch (err) {
        return Response.json({ error: err instanceof Error ? err.message : 'Speech failed' }, { status: 502 })
    }
}
