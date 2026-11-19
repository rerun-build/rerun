'use client'

import { useEffect, useState } from 'react'

import { listConnectorCatalogAction } from '@/app/api/_actions/template.actions'
import type { ConnectorCatalog } from '@moldwright/ui/new-agent'

let loaded: ConnectorCatalog | null = null
let loading: Promise<ConnectorCatalog> | null = null

function loadCatalog(): Promise<ConnectorCatalog> {
    loading ??= listConnectorCatalogAction()
        .then(entries => {
            loaded = new Map(entries.map(entry => [entry.slug, entry]))
            return loaded
        })
        .catch(error => {
            loading = null
            throw error
        })
    return loading
}

export function useConnectorCatalog(enabled: boolean): ConnectorCatalog | null {
    const [catalog, setCatalog] = useState<ConnectorCatalog | null>(loaded)

    useEffect(() => {
        if (!enabled || catalog) return
        let active = true
        loadCatalog().then(
            next => {
                if (active) setCatalog(next)
            },
            () => {}
        )
        return () => {
            active = false
        }
    }, [enabled, catalog])

    return catalog
}
