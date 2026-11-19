import { byRecency } from '@rerun/contracts'

import { coworkerEndpoints } from '@/chat/endpoints'
import { loadTranscript } from '@/data/local-cache'

type Caller = { accessToken: string; workspaceId: number }
type Preloadable = { id: string; generalSessionId: string | null; latest: { updatedAt: string } | null }

// The Generals of the coworkers talked to last, read while the Home rests: the next one tapped opens
// on its latest messages, already in memory. One after the other, each naming the copy the phone keeps
// (a 304 costs next to nothing), and not again for a while.
const PRELOADED = 4
const AGAIN_AFTER_MS = 5 * 60_000

const preloadedAt = new Map<string, number>()

export async function preloadGenerals(caller: Caller, coworkers: readonly Preloadable[], now = Date.now()) {
    const due = [...coworkers]
        .sort(byRecency)
        .filter((coworker): coworker is Preloadable & { generalSessionId: string } => !!coworker.generalSessionId)
        .slice(0, PRELOADED)
        .filter(coworker => now - (preloadedAt.get(coworker.generalSessionId) ?? 0) >= AGAIN_AFTER_MS)
    for (const coworker of due) {
        preloadedAt.set(coworker.generalSessionId, now)
        await loadTranscript(caller.workspaceId, coworker.generalSessionId, etag => coworkerEndpoints(coworker.id).messages(caller, coworker.generalSessionId, etag)).catch(() => {})
    }
}

// A launch again, for the tests.
export function forgetPreloads() {
    preloadedAt.clear()
}
