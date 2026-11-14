const OG_CACHE_CONTROL = 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800'

type CachedOg = { body: Buffer; contentType: string; expiresAt: number }

export function ogResponse(body: Buffer, contentType: string) {
    return new Response(new Uint8Array(body), {
        headers: { 'Content-Type': contentType, 'Cache-Control': OG_CACHE_CONTROL },
    })
}

export function createOgCache({ ttlMs, maxEntries }: { ttlMs: number; maxEntries: number }) {
    const entries = new Map<string, CachedOg>()

    return {
        get(key: string): CachedOg | null {
            const cached = entries.get(key)
            if (!cached) return null
            if (cached.expiresAt <= Date.now()) {
                entries.delete(key)
                return null
            }
            return cached
        },
        set(key: string, body: Buffer, contentType: string) {
            entries.set(key, { body, contentType, expiresAt: Date.now() + ttlMs })
            if (entries.size > maxEntries) {
                const oldest = entries.keys().next().value
                if (oldest !== undefined) entries.delete(oldest)
            }
        },
    }
}
