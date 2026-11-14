'use client'

import { useEffect, useState } from 'react'
import { getSharedTemplateAction } from '@/app/api/_actions/template.actions'
import type { LibraryTemplate } from '@/lib/templates/library'

export type TemplateBySlug = { status: 'loading' } | { status: 'found'; template: LibraryTemplate } | { status: 'missing' }

const cache = new Map<string, LibraryTemplate | null>()
const inFlight = new Map<string, Promise<LibraryTemplate | null>>()

export function useTemplateBySlug(slug: string | null): TemplateBySlug {
    const [, bumpVersion] = useState(0)
    const cached = slug ? cache.get(slug) : undefined

    useEffect(() => {
        if (!slug || cache.has(slug)) return
        let active = true
        let request = inFlight.get(slug)
        if (!request) {
            request = getSharedTemplateAction(slug)
            inFlight.set(slug, request)
        }
        void request
            .then(found => {
                cache.set(slug, found)
            })
            .catch(() => {
                cache.set(slug, null)
            })
            .finally(() => {
                inFlight.delete(slug)
                if (active) bumpVersion(version => version + 1)
            })
        return () => {
            active = false
        }
    }, [slug])

    if (!slug) return { status: 'missing' }
    if (cached === undefined) return { status: 'loading' }
    return cached ? { status: 'found', template: cached } : { status: 'missing' }
}
