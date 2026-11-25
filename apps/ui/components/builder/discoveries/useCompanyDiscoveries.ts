'use client'

import { useEffect } from 'react'

import type { CompanyFindingsRow } from '@/lib/company/explore/findings'
import { useDiscoveriesStore } from '@/stores/discoveries.store'

const ENDPOINT = '/api/onboarding/discoveries'
const POLL_MS = 3000
// The row is written the moment the exploration is requested, so nothing at all after this long
// means none was: a workspace without a site, or one that never got as far as the welcome card.
const EMPTY_READS_BEFORE_GIVING_UP = 10
// One exploration at a time across every signup: a busy hour can keep a run queued for a while.
const MAX_POLL_MS = 20 * 60 * 1000

/** Reads the full exploration back while it runs: the cards it adds and the sources it is still on. */
export function useCompanyDiscoveries(active: boolean) {
    useEffect(() => {
        if (!active) return
        let stopped = false
        let timer: ReturnType<typeof setTimeout> | undefined
        let emptyReads = 0
        const startedAt = Date.now()

        const read = async () => {
            const row = await fetch(ENDPOINT, { cache: 'no-store' })
                .then(response => (response.ok ? (response.json() as Promise<CompanyFindingsRow | null>) : null))
                .catch(() => null)
            if (stopped) return
            if (row) useDiscoveriesStore.getState().applyRow(row)
            else emptyReads += 1

            const settled = row !== null && row.status !== 'running'
            if (settled || emptyReads >= EMPTY_READS_BEFORE_GIVING_UP || Date.now() - startedAt > MAX_POLL_MS) return
            timer = setTimeout(read, POLL_MS)
        }
        void read()

        return () => {
            stopped = true
            clearTimeout(timer)
        }
    }, [active])
}
