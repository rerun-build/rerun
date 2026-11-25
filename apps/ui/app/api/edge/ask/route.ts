import { isServedHostname } from '@rerun/cloud/organizations.server'
import { createHash, timingSafeEqual } from 'node:crypto'

export const dynamic = 'force-dynamic'

// Names a process turns down in a minute before it stops looking them up: somebody knocking with
// made-up ones. A name it serves never counts, so its certificate is never held back by them.
const MAX_REFUSALS_PER_MINUTE = 300
const WINDOW_MS = 60_000

let windowStart = 0
let refusals = 0

function refusedTooMany(now: number): boolean {
    if (now - windowStart >= WINDOW_MS) {
        windowStart = now
        refusals = 0
    }
    return refusals >= MAX_REFUSALS_PER_MINUTE
}

const digest = (value: string): Buffer => createHash('sha256').update(value).digest()

function isEdge(given: string | null): boolean {
    const key = process.env.ORGANIZATION_EDGE_KEY
    return !!key && !!given && timingSafeEqual(digest(given), digest(key))
}

const answer = (status: 200 | 404 | 429) => new Response(null, { status, headers: { 'Cache-Control': 'no-store' } })

// What Caddy asks before it gets a certificate on demand: is this name ours to serve? Yes for an
// organization's address and for a domain it proved, and no, always the same no, for anything else,
// for a caller without the key and for a question that could not be answered. Caddy adds `domain` to
// the URL of its `ask` and can add nothing else, so the key travels in the query next to it.
export async function GET(req: Request) {
    const { searchParams } = new URL(req.url)
    if (!isEdge(searchParams.get('key'))) return answer(404)
    try {
        if (await isServedHostname((searchParams.get('domain') ?? '').toLowerCase())) return answer(200)
        if (refusedTooMany(Date.now())) return answer(429)
        refusals += 1
        return answer(404)
    } catch (err) {
        console.error('[edge] a name could not be looked up', err)
        return answer(404)
    }
}
