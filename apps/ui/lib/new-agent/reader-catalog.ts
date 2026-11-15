import { loadServiceCatalog, type CatalogEntry } from '@/lib/templates/catalog'
import { createClient } from '@/supabase/server'

const CATALOG_TTL_MS = 5 * 60 * 1000
let cachedCatalog: { entries: CatalogEntry[]; at: number } | null = null

export async function readerCatalog(): Promise<CatalogEntry[]> {
    if (cachedCatalog && Date.now() - cachedCatalog.at < CATALOG_TTL_MS) return cachedCatalog.entries
    const entries = [...(await loadServiceCatalog(await createClient())).values()]
    if (entries.length > 0) cachedCatalog = { entries, at: Date.now() }
    return entries
}
