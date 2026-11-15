import { AGENT_NAME_MAX, MAX_APPS_AT_CREATION } from '@rerun/ui/new-agent/reading'

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/

type Query = { get: (key: string) => string | null }

export function readHeroAgentName(query: Query): string | null {
    return query.get('name')?.trim().slice(0, AGENT_NAME_MAX) || null
}

export function readHeroAgentApps(query: Query): string[] {
    const slugs = (query.get('apps') ?? '').split(',').map(slug => slug.trim()).filter(slug => SLUG.test(slug))
    return [...new Set(slugs)].slice(0, MAX_APPS_AT_CREATION)
}
