import { logger, queue, schedules } from '@trigger.dev/sdk/v3'
import { SEARCH_CACHE_TTL_MS } from '@/lib/search/cache'
import { createServiceRoleClient } from '@/supabase/serviceRole'

const purgeQueue = queue({ name: 'purge-web-search-cache', concurrencyLimit: 1 })

export async function purgeWebSearchCache(): Promise<{ purged: number }> {
    const cutoff = new Date(Date.now() - SEARCH_CACHE_TTL_MS).toISOString()
    const { count, error } = await createServiceRoleClient().from('web_search_cache').delete({ count: 'exact' }).lt('fetched_at', cutoff)
    if (error) throw new Error(error.message)

    const purged = count ?? 0
    logger.log('web search cache purged', { purged, cutoff })
    return { purged }
}

export const purgeWebSearchCacheDaily = schedules.task({
    id: 'purge-web-search-cache-daily',
    cron: { pattern: '40 3 * * *', timezone: 'Europe/Paris' },
    queue: purgeQueue,
    maxDuration: 300,
    retry: { maxAttempts: 1 },
    run: async () => purgeWebSearchCache(),
})
