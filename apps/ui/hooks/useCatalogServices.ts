'use client'

import { useEffect, useReducer } from 'react'

import { getCatalogServicesBySlugsAction } from '@/app/api/_actions/services.actions'
import type { ServiceSearchResult } from '@/lib/services/types'

const cache = new Map<string, ServiceSearchResult | null>()
const inFlight = new Map<string, Promise<void>>()

async function resolve(slugs: string[]): Promise<void> {
    const rows = await getCatalogServicesBySlugsAction(slugs)
    const found = new Map(rows.map(row => [row.slug, row]))
    for (const slug of slugs) cache.set(slug, found.get(slug) ?? null)
}

export function useCatalogServices(slugs: string[]): { resolved: Map<string, ServiceSearchResult>; loading: boolean } {
    const key = slugs.join(',')
    const [, rerender] = useReducer((tick: number) => tick + 1, 0)

    useEffect(() => {
        const wanted = key ? key.split(',') : []
        const waits = [...new Set(wanted.map(slug => inFlight.get(slug)).filter((pending): pending is Promise<void> => !!pending))]
        const unasked = wanted.filter(slug => !cache.has(slug) && !inFlight.has(slug))
        if (!unasked.length && !waits.length) return

        if (unasked.length) {
            const job = resolve(unasked).finally(() => {
                for (const slug of unasked) inFlight.delete(slug)
            })
            for (const slug of unasked) inFlight.set(slug, job)
            waits.push(job)
        }

        let alive = true
        void Promise.all(waits).then(() => {
            if (alive) rerender()
        })
        return () => {
            alive = false
        }
    }, [key])

    const resolved = new Map<string, ServiceSearchResult>()
    for (const slug of slugs) {
        const row = cache.get(slug)
        if (row) resolved.set(slug, row)
    }

    return { resolved, loading: slugs.some(slug => !cache.has(slug)) }
}
