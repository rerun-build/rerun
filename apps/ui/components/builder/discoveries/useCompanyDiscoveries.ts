'use client'

import { useEffect } from 'react'

import type { CompanyFindingsRow, DiscoveryEvent } from '@/lib/company/explore/findings'
import { useDiscoveriesStore } from '@/stores/discoveries.store'

const ENDPOINT = '/api/onboarding/discoveries'
const POLL_MS = 3000
const EMPTY_READS_BEFORE_GIVING_UP = 10
const MAX_POLL_MS = 20 * 60 * 1000

const siteDomain = (site: string) => {
    try {
        return new URL(/^https?:\/\//i.test(site) ? site : `https://${site}`).hostname.replace(/^www\./i, '')
    } catch {
        return site
    }
}

let live: { domain: string; controller: AbortController; result: Promise<boolean> } | null = null

export function streamLiveDiscoveries(site: string): Promise<boolean> {
    const domain = siteDomain(site)
    if (live?.domain === domain) return live.result
    live?.controller.abort()
    const controller = new AbortController()
    live = { domain, controller, result: readLiveStream(site, domain, controller.signal) }
    return live.result
}

async function readLiveStream(site: string, domain: string, signal: AbortSignal): Promise<boolean> {
    const store = useDiscoveriesStore.getState()
    store.reset(domain)

    let found = 0
    try {
        const response = await fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: site }), signal })
        if (!response.ok || !response.body) return false
        const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
        let buffer = ''
        for (;;) {
            const { value, done } = await reader.read()
            if (done) break
            buffer += value
            const lines = buffer.split('\n')
            buffer = lines.pop() ?? ''
            const events = lines.filter(Boolean).map(line => JSON.parse(line) as DiscoveryEvent)
            found += events.filter(event => event.type === 'found').length
            store.apply(events)
        }
        return found > 0
    } catch {
        if (!signal.aborted) store.apply([{ type: 'end' }])
        return false
    }
}

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
