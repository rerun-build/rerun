import type { GeneralSession, SessionUsageSeed } from '@/app/api/_services/chat.service'
import type { HistoryMessage } from '@/lib/chat/engine-history'
import type { EngineSkillProposal } from '@/lib/engine/types'

// What a reopened conversation needs in one read: transcript, context gauge, why the last run
// failed, the run to attach to, and the skill proposals still waiting.
export type SessionSnapshot = {
    messages: HistoryMessage[]
    usage: SessionUsageSeed | null
    lastError: string | null
    activeRunId: string | null
    proposals: EngineSkillProposal[]
}

export const EMPTY_SESSION_SNAPSHOT: SessionSnapshot = { messages: [], usage: null, lastError: null, activeRunId: null, proposals: [] }

// Both reads below go to a route rather than a server action. Actions from one page run one after
// the other, so the transcript used to wait behind everything the panel mounts with it; a fetch
// leaves at once, alongside them.

// A conversation that cannot be read opens empty, as it did when the read could fail.
export async function fetchSessionSnapshot(sessionId: string): Promise<SessionSnapshot> {
    const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/snapshot`, { cache: 'no-store' })
    return res.ok ? ((await res.json()) as SessionSnapshot) : EMPTY_SESSION_SNAPSHOT
}

// The coworker's General, null until someone has spoken in it.
export async function fetchGeneralSession(agentId: string): Promise<GeneralSession | null> {
    const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/general`, { cache: 'no-store' })
    return res.ok ? ((await res.json()) as { general: GeneralSession | null }).general : null
}
