'use client'

import { getCatalogServicesBySlugsAction } from '@/app/api/_actions/services.actions'
import { useEffect, useState } from 'react'

export type CatalogTool = { slug: string; name: string; icon: string | null; category: string }

export function useCatalogTools(slugs: string[]): CatalogTool[] | null {
    const [cache, setCache] = useState<{ key: string; tools: CatalogTool[] } | null>(null)
    const key = slugs.join(',')
    const tools = cache?.key === key ? cache.tools : null

    useEffect(() => {
        if (tools || slugs.length === 0) return
        let active = true
        void getCatalogServicesBySlugsAction(slugs).then(rows => {
            if (!active) return
            const bySlug = new Map(rows.map(row => [row.slug, row]))
            setCache({
                key,
                tools: slugs.flatMap(slug => {
                    const row = bySlug.get(slug)
                    return row ? [{ slug: row.slug, name: row.name, icon: row.icon, category: row.category }] : []
                }),
            })
        })
        return () => {
            active = false
        }
    }, [key, slugs, tools])

    return tools
}
