import type { Database } from '@/app/api/database.types'
import type { SupabaseClient } from '@supabase/supabase-js'
import { selectMany } from '@/supabase/supabase-helpers'

import type { CatalogEntry } from '@moldwright/ui/new-agent'

export type { CatalogEntry }

export type ServiceCatalog = Map<string, CatalogEntry>

export async function loadServiceCatalog(supabase: SupabaseClient<Database>, slugs?: string[]): Promise<ServiceCatalog> {
    const filters = slugs ? { enabled: true, slug: { in: slugs } } : { enabled: true }
    const { data } = await selectMany(supabase, 'services', ['slug', 'name', 'icon', 'category'] as const, filters, { column: 'name' })

    return new Map((data ?? []).map(row => [row.slug, { slug: row.slug, name: row.name, icon: row.icon, category: row.category }]))
}
