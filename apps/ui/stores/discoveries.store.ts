import { create } from 'zustand'

import { applyDiscoveryEvent, EMPTY_DISCOVERIES, rowToEvents, type CompanyFindingsRow, type DiscoveriesState, type DiscoveryEvent } from '@/lib/company/explore/findings'

// What the onboarding board shows of the company: fed live by the welcome card while the site is
// being typed, then by the full exploration read back from the database. Not persisted: after a
// reload the full exploration brings its cards back, and the live ones were only a preview of it.

// The free sources answer within the same second, and cards landing all together read as a page
// loading rather than as things being found. One at a time, at least this far apart.
const LANDING_GAP_MS = 450

type DiscoveriesStore = {
    state: DiscoveriesState
    domain: string | null
    apply: (events: DiscoveryEvent[]) => void
    applyRow: (row: CompanyFindingsRow) => void
}

let queued: DiscoveryEvent[] = []
let timer: ReturnType<typeof setTimeout> | null = null
let lastLanding = 0

export const useDiscoveriesStore = create<DiscoveriesStore>()((set, get) => {
    // Only a card waits its turn; teasers, drops and the end follow it in order without a gap.
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
        // Measured against what the board will show once the queue has landed, so a card still
        // waiting its turn is not queued a second time by the next read.
        applyRow: row => {
            const projected = queued.reduce(applyDiscoveryEvent, get().state)
            const events = rowToEvents(row, projected)
            const domain = new URL(row.url).hostname.replace(/^www\./i, '')
            if (get().domain !== domain) set({ domain })
            if (events.length) get().apply(events)
        },
    }
})
