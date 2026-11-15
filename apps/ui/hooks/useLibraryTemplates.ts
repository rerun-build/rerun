'use client'

import { listLibraryTemplatesAction } from '@/app/api/_actions/template.actions'
import type { LibraryTemplate } from '@/lib/templates/library'
import { useTemplatePurchaseStore } from '@/stores/template-purchase.store'
import { useSession } from '@/supabase/session/SessionProvider'
import { useEffect, useState } from 'react'

let cache: { key: string; rows: LibraryTemplate[] } | null = null
let inFlight: { key: string; promise: Promise<LibraryTemplate[]> } | null = null

export function useLibraryTemplates(enabled: boolean): LibraryTemplate[] | null {
    const workspaceId = useSession().workspace?.id
    const purchaseVersion = useTemplatePurchaseStore(state => state.version)
    const key = `${workspaceId ?? 'none'}:${purchaseVersion}`

    const [, bumpVersion] = useState(0)
    const templates = cache?.key === key ? cache.rows : null

    useEffect(() => {
        if (!enabled || templates) return
        let active = true
        if (inFlight?.key !== key) inFlight = { key, promise: listLibraryTemplatesAction() }
        void inFlight.promise.then(rows => {
            cache = { key, rows }
            if (active) bumpVersion(v => v + 1)
        })
        return () => {
            active = false
        }
    }, [enabled, templates, key])

    return templates
}
