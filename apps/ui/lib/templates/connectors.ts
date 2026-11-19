import type { TemplateConnector } from '@moldwright/contracts'
import type { Database } from '@/app/api/database.types'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadServiceCatalog } from './catalog'

export async function resolveAgentConnectors(
    supabase: SupabaseClient<Database>,
    agents: { connectorSlugs: string[] }[],
): Promise<{ connectors: TemplateConnector[]; warnings: string[] }> {
    const slugs = [...new Set(agents.flatMap(agent => agent.connectorSlugs))]
    if (slugs.length === 0) return { connectors: [], warnings: [] }

    const catalog = await loadServiceCatalog(supabase, slugs)
    const unknown = slugs.filter(slug => !catalog.has(slug))
    const warnings = unknown.length > 0 ? [`Not in the services catalog, so they will render without a name or icon: ${unknown.join(', ')}.`] : []

    const connectors = slugs.map(slug => {
        const entry = catalog.get(slug)
        return { slug, name: entry?.name ?? slug, icon: entry?.icon ?? null }
    })

    return { connectors, warnings }
}
