import { COWORKER_DOCK_FOREMAN_ID, type CoworkerDockCoworker, type CoworkerDockMood } from '@rerun/contracts'
import type { OrbActivity } from '@rerun/ui/foreman'

import type { ForemanDockFeed } from '@/lib/foreman/dock-feed'

export function isForemanDockEntry(coworker: { id: string }): boolean {
    return coworker.id === COWORKER_DOCK_FOREMAN_ID
}

function foremanMood(feed: ForemanDockFeed, activity: OrbActivity): CoworkerDockMood {
    if (feed.busy || activity === 'thinking' || activity === 'speaking') return 'working'
    if (feed.pending) return 'waiting'
    if (feed.failed) return 'error'
    return 'idle'
}

/** The Chief of Staff as the dock shows it: what it is doing, and a question it is waiting on. */
export function foremanDockEntry({ feed, activity, name }: { feed: ForemanDockFeed; activity: OrbActivity; name: string }): CoworkerDockCoworker {
    return { id: COWORKER_DOCK_FOREMAN_ID, name, mood: foremanMood(feed, activity), pending: feed.pending ? 1 : 0 }
}

/** The orb of the dock: it thinks while the Chief of Staff works, rests otherwise. */
export function foremanDockOrbState(mood: CoworkerDockMood): OrbActivity {
    return mood === 'working' ? 'thinking' : 'idle'
}
