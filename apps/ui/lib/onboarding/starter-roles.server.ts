import 'server-only'

import type { Database } from '@/app/api/database.types'
import { connectorsFromRow } from '@/lib/templates/document'
import { selectMany } from '@/supabase/supabase-helpers'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { CatalogEntry } from '@rerun/ui/new-agent'
import { SECTOR_PACKS, STARTER_PACKS } from './starter-packs'

export type StarterRole = { title: string; apps: CatalogEntry[] }

const MAX_APPS = 3

// The job and the apps of every coworker a starter pack can offer, read from its template.
export async function readStarterRoles(supabase: SupabaseClient<Database>): Promise<Record<string, StarterRole>> {
    const slugs = [...new Set([...Object.values(STARTER_PACKS), ...Object.values(SECTOR_PACKS)].flat().map(card => card.template))]
    const { data } = await selectMany(supabase, 'templates', ['slug', 'title', 'connectors'] as const, { slug: slugs, status: 'published' })
    return Object.fromEntries((data ?? []).map(row => [row.slug, { title: row.title, apps: connectorsFromRow.parse(row.connectors).slice(0, MAX_APPS) }]))
}
