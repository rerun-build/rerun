import { checkinTriageRequestSchema } from '@rerun/contracts'

import { authenticateEngineToken } from '@/app/api/_services/workspace-engine.service'
import { triageCheckin } from '@/lib/foreman/checkin-triage'

// A box asks whether today is worth a check-in of its Chief of Staff, with its engine key. Its
// digest is numbers and short labels, held to a strict shape and a small size. A box asks once a day;
// this caps a workspace at a few calls a day, in this process, whatever it sends.
export const dynamic = 'force-dynamic'

const BODY_MAX_BYTES = 8 * 1024
const CALLS_PER_DAY = 4
const DAY_MS = 24 * 60 * 60_000
const calls = new Map<number, number[]>()

function takeCall(workspaceId: number, now = Date.now()): boolean {
    const recent = (calls.get(workspaceId) ?? []).filter(at => now - at < DAY_MS)
    if (recent.length >= CALLS_PER_DAY) return false
    calls.set(workspaceId, [...recent, now])
    return true
}

export async function POST(req: Request): Promise<Response> {
    const header = req.headers.get('authorization') ?? ''
    const engine = await authenticateEngineToken(header.startsWith('Bearer ') ? header.slice(7) : '')
    if (!engine) return new Response('Unauthorized', { status: 401 })

    const raw = await req.text()
    if (raw.length > BODY_MAX_BYTES) return Response.json({ error: 'Digest too large' }, { status: 413 })
    let body: unknown
    try {
        body = JSON.parse(raw)
    } catch {
        return Response.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    const parsed = checkinTriageRequestSchema.safeParse(body)
    if (!parsed.success) return Response.json({ error: 'Invalid digest' }, { status: 400 })

    if (!takeCall(engine.workspaceId)) return Response.json({ error: 'Too many triage calls today' }, { status: 429 })
    const answer = await triageCheckin(parsed.data.digest)
    if (!answer) return Response.json({ error: 'Triage unavailable' }, { status: 503 })
    return Response.json(answer)
}
