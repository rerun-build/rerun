import { EMPTY_READING, MAX_READABLE_LENGTH, MIN_READABLE_LENGTH, type JobReading } from '@moldwright/ui/new-agent/reading'

import { readAgentJob } from '@/lib/ai/read-agent-job'
import { createReadingLimiter } from '@/lib/new-agent/public-reading-limit'
import { readerCatalog } from '@/lib/new-agent/reader-catalog'

const LANDING_ORIGIN = new URL(process.env.NEXT_PUBLIC_LANDING_URL ?? 'https://rerun.build').origin
const LOCAL_ORIGIN = /^http:\/\/localhost:\d+$/

const CACHE_MAX = 500
const cache = new Map<string, JobReading>()
const allow = createReadingLimiter()

function allowedOrigin(request: Request): string | null {
    const origin = request.headers.get('origin')
    if (!origin) return null
    if (origin === LANDING_ORIGIN) return origin
    return process.env.NODE_ENV !== 'production' && LOCAL_ORIGIN.test(origin) ? origin : null
}

function caller(request: Request): string {
    return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
}

function remember(text: string, reading: JobReading) {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value ?? text)
    cache.set(text, reading)
}

async function read(request: Request): Promise<JobReading> {
    const text = (await request.text()).trim().slice(0, MAX_READABLE_LENGTH)
    if (text.length < MIN_READABLE_LENGTH) return EMPTY_READING

    const known = cache.get(text)
    if (known) return known
    if (!allow(caller(request))) return EMPTY_READING

    const reading = await readAgentJob(text, await readerCatalog())
    remember(text, reading)
    return reading
}

export async function POST(request: Request) {
    const origin = allowedOrigin(request)
    if (!origin) return new Response(null, { status: 403 })

    const reading = await read(request).catch(() => EMPTY_READING)
    return Response.json(reading, { headers: { 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Cache-Control': 'no-store' } })
}
