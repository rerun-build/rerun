import { create } from 'zustand'

import { applyDiscoveryEvent, EMPTY_DISCOVERIES, rowToEvents, type CompanyFindingsRow, type DiscoveriesState, type DiscoveryEvent } from '@/lib/company/explore/findings'

const LANDING_GAP_MS = 450

type DiscoveriesStore = {
    state: DiscoveriesState
    domain: string | null
    apply: (events: DiscoveryEvent[]) => void
    applyRow: (row: CompanyFindingsRow) => void
    reset: (domain: string | null) => void
}

let queued: DiscoveryEvent[] = []
let timer: ReturnType<typeof setTimeout> | null = null
let lastLanding = 0

export const useDiscoveriesStore = create<DiscoveriesStore>()((set, get) => {
    function drain() {
        timer = null
        while (queued.length) {
            const event = queued[0]
            if (event.type === 'found') {
                const wait = lastLanding + LANDING_GAP_MS - Date.now()
                if (wait > 0) {
                    timer = setTimeout(drain, wait)
                    return
                }
                lastLanding = Date.now()
            }
            queued.shift()
            set(current => ({ state: applyDiscoveryEvent(current.state, event) }))
        }
    }

    return {
        state: EMPTY_DISCOVERIES,
        domain: null,
        apply: events => {
            queued.push(...events)
            if (!timer) drain()
        },
        applyRow: row => {
            const projected = queued.reduce(applyDiscoveryEvent, get().state)
            const events = rowToEvents(row, projected)
            const domain = new URL(row.url).hostname.replace(/^www\./i, '')
            if (get().domain !== domain) set({ domain })
            if (events.length) get().apply(events)
        },
        reset: domain => {
            queued = []
            if (timer) clearTimeout(timer)
            timer = null
            set({ state: EMPTY_DISCOVERIES, domain })
        },
    }
})
