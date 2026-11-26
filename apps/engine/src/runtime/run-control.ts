type RunHandle = { controller: AbortController; agentId: string; script: boolean; cancel?: () => Promise<void> }

const controllers = new Map<string, RunHandle>()

// One live run per conversation. Two runs on the same session read the same history before
// either has written its user message, so they answer past each other and interleave their
// messages into one transcript. Claimed synchronously, before the run row is even inserted,
// so a duplicate request cannot slip through the await.
type SessionClaim = { runId: string; claimedAt: number; authorId?: string }

const sessionClaims = new Map<string, SessionClaim>()
const claimedSessions = new Map<string, string>()

// `script`: the run of a script routine. It is live like any other, so an update of the engine waits
// for it and a cancel finds it, but it runs no model and drives no screen: its coworker stays free.
export function registerRunAbort(runId: string, agentId: string, { script = false }: { script?: boolean } = {}): AbortController {
    const controller = new AbortController()
    controllers.set(runId, { controller, agentId, script })
    return controller
}

// The abort signal alone is not enough to stop a hung run: the codex provider ignores it until its
// turn has actually started, which is exactly the case when an expired token wedges the handshake.
// The run loop registers here what it takes to really close itself down.
export function setRunCancel(runId: string, cancel: () => Promise<void>): void {
    const handle = controllers.get(runId)
    if (handle) handle.cancel = cancel
}

export function unregisterRunAbort(runId: string): void {
    controllers.delete(runId)
    releaseSession(runId)
}

export function claimSession(sessionId: string, runId: string, authorId?: string): string | null {
    const holder = sessionClaims.get(sessionId)
    if (holder) return holder.runId
    sessionClaims.set(sessionId, { runId, claimedAt: Date.now(), authorId })
    claimedSessions.set(runId, sessionId)
    return null
}

export function sessionClaim(sessionId: string): SessionClaim | null {
    return sessionClaims.get(sessionId) ?? null
}

export function releaseSession(runId: string): void {
    const sessionId = claimedSessions.get(runId)
    if (!sessionId) return
    claimedSessions.delete(runId)
    if (sessionClaims.get(sessionId)?.runId === runId) sessionClaims.delete(sessionId)
}

export function agentHasLiveRun(agentId: string): boolean {
    for (const handle of controllers.values()) if (handle.agentId === agentId && !handle.script) return true
    return false
}

export function activeRunCount(): number {
    return controllers.size
}

export function sessionClaimCount(): number {
    return sessionClaims.size
}

// Null for a run that is not live here. Resolves once the transcript holds what the stopped run did:
// the conversation is only freed then, or the next message would read a history missing that turn.
export function abortRun(runId: string): Promise<void> | null {
    const handle = controllers.get(runId)
    if (!handle) return null
    controllers.delete(runId)
    handle.controller.abort()
    // Closes the run for good: writes its terminal row, tells the hub, and tears the provider
    // process down. Without it a provider that ignores the abort keeps the conversation "working".
    const stored = handle.cancel?.() ?? Promise.resolve()
    return stored.catch(() => {}).then(() => releaseSession(runId))
}
