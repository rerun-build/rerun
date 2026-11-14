'use client'

import { listLibraryCreatorsAction } from '@/app/api/_actions/template.actions'
import type { LibraryCreator } from '@/lib/templates/library'
import { useEffect, useState } from 'react'

let cache: LibraryCreator[] | null = null
let inFlight: Promise<LibraryCreator[]> | null = null

export function useLibraryCreators(enabled: boolean): LibraryCreator[] | null {
    const [creators, setCreators] = useState(cache)

    useEffect(() => {
        if (!enabled || creators) return
        let active = true
        inFlight ??= listLibraryCreatorsAction()
            .then(rows => {
                cache = rows
                return rows
            })
            .catch(() => {
                inFlight = null
                return []
            })
        void inFlight.then(rows => {
            if (active) setCreators(rows)
        })
        return () => {
            active = false
        }
    }, [enabled, creators])

    return creators
}
