import { z } from 'zod'

export type JobSchedule = { label: string; source: string | null }
export type JobReading = { name: string | null; apps: string[]; schedule: JobSchedule | null }

export const EMPTY_READING: JobReading = { name: null, apps: [], schedule: null }

export const MIN_READABLE_LENGTH = 12
export const MAX_READABLE_LENGTH = 500
export const MAX_APPS_AT_CREATION = 6

export const AGENT_NAME_MAX = 60

const MAX_READ_APPS = 5
const MAX_LABEL_LENGTH = 60

const replySchema = z.object({
    name: z.string().nullish(),
    apps: z.array(z.unknown()).nullish(),
    schedule: z.object({ label: z.string().nullish(), source: z.string().nullish() }).nullish(),
})

export function parseJobReading(reply: string, text: string, catalogSlugs: string[]): JobReading {
    const json = reply.match(/\{[\s\S]*\}/)?.[0]
    if (!json) return EMPTY_READING

    let raw: unknown
    try {
        raw = JSON.parse(json)
    } catch {
        return EMPTY_READING
    }
    const parsed = replySchema.safeParse(raw)
    if (!parsed.success) return EMPTY_READING

    const bySlug = new Map(catalogSlugs.map(slug => [slug.toLowerCase(), slug]))
    const apps = (parsed.data.apps ?? []).flatMap(app => {
        const slug = typeof app === 'string' ? bySlug.get(app.trim().toLowerCase()) : undefined
        return slug ? [slug] : []
    })

    return {
        name: parsed.data.name?.trim().slice(0, AGENT_NAME_MAX) || null,
        apps: [...new Set(apps)].slice(0, MAX_READ_APPS),
        schedule: readSchedule(parsed.data.schedule, text),
    }
}

function readSchedule(schedule: { label?: string | null; source?: string | null } | null | undefined, text: string): JobSchedule | null {
    const label = schedule?.label?.trim().slice(0, MAX_LABEL_LENGTH)
    if (!label) return null
    return { label, source: sourceIn(text, schedule?.source) }
}

function sourceIn(text: string, source: string | null | undefined): string | null {
    const wanted = source?.trim()
    if (!wanted) return null
    const at = text.toLowerCase().indexOf(wanted.toLowerCase())
    return at < 0 ? null : text.slice(at, at + wanted.length)
}
