import { z } from 'zod'

import type { EngineProvider } from '@/lib/engine/types'

export type StatusPage = { id: string; label: string; url: string; components: string[]; providers: EngineProvider[] }

export const PROVIDER_STATUS_PAGES: StatusPage[] = [
    {
        id: 'openai',
        label: 'OpenAI',
        url: 'https://status.openai.com',
        components: ['01JMXBRMFE6N2NNT7DG6XZQ6PW', '01JP8CD9JR3HR6Y7G4Q75N4DVW'],
        providers: ['openai', 'codex'],
    },
    {
        id: 'anthropic',
        label: 'Anthropic',
        url: 'https://status.claude.com',
        components: ['k8w3r06qmzrp', 'yyzkbfz2thpt'],
        providers: ['anthropic', 'claude'],
    },
]

export function statusPagesFor(providers: EngineProvider[]): string[] {
    return PROVIDER_STATUS_PAGES.filter(page => page.providers.some(provider => providers.includes(provider))).map(page => page.id)
}

export type ProviderIncident = {
    id: string
    provider: string
    label: string
    severity: 'degraded' | 'outage'
    title: string
    url: string
}

const summarySchema = z.object({
    components: z.array(z.object({ id: z.string(), name: z.string(), status: z.string() })),
    incidents: z.array(z.object({ id: z.string(), name: z.string(), components: z.array(z.object({ id: z.string() })).optional() })).optional(),
})

const SEVERITY_BY_COMPONENT_STATUS: Record<string, ProviderIncident['severity']> = {
    partial_outage: 'degraded',
    major_outage: 'outage',
}

export function parseStatusSummary(page: StatusPage, json: unknown): ProviderIncident | null {
    const parsed = summarySchema.safeParse(json)
    if (!parsed.success) return null

    const { components, incidents = [] } = parsed.data
    const down = components.filter(component => page.components.includes(component.id) && SEVERITY_BY_COMPONENT_STATUS[component.status])
    if (down.length === 0) return null

    const downIds = down.map(component => component.id)
    const incident =
        incidents.find(candidate => candidate.components?.some(component => downIds.includes(component.id))) ??
        incidents.find(candidate => !candidate.components?.length)

    return {
        id: `${page.id}:${incident?.id ?? downIds.join('+')}`,
        provider: page.id,
        label: page.label,
        severity: down.some(component => component.status === 'major_outage') ? 'outage' : 'degraded',
        title: incident?.name ?? down.map(component => component.name).join(', '),
        url: incident ? `${page.url}/incidents/${incident.id}` : page.url,
    }
}

const CACHE_TTL_MS = 60 * 1000
const FETCH_TIMEOUT_MS = 5000

const lastKnown = new Map<string, ProviderIncident | null>()
let fetchedAt = 0
let inFlight: Promise<void> | null = null

async function refresh(page: StatusPage): Promise<void> {
    try {
        const res = await fetch(`${page.url}/api/v2/summary.json`, { cache: 'no-store', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
        if (!res.ok) return
        lastKnown.set(page.id, parseStatusSummary(page, await res.json()))
    } catch {}
}

export async function getProviderIncidents(): Promise<ProviderIncident[]> {
    if (Date.now() - fetchedAt >= CACHE_TTL_MS) {
        inFlight ??= Promise.all(PROVIDER_STATUS_PAGES.map(refresh)).then(() => {
            fetchedAt = Date.now()
            inFlight = null
        })
        await inFlight
    }
    return PROVIDER_STATUS_PAGES.flatMap(page => lastKnown.get(page.id) ?? [])
}
