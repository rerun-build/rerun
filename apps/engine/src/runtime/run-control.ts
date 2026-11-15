import type { UIMessageStreamWriter } from 'ai'
import { setAgentStatus } from '../db/repos/agents.js'

type RunHandle = { controller: AbortController; agentId: string; cancel?: () => void; writer?: UIMessageStreamWriter }

const controllers = new Map<string, RunHandle>()

type SessionClaim = { runId: string; claimedAt: number; authorId?: string }

const sessionClaims = new Map<string, SessionClaim>()
const claimedSessions = new Map<string, string>()

export function registerRunAbort(runId: string, agentId: string, writer?: UIMessageStreamWriter): AbortController {
    const controller = new AbortController()
    controllers.set(runId, { controller, agentId, writer })
    return controller
}

export function setRunCancel(runId: string, cancel: () => void): void {
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
    for (const handle of controllers.values()) if (handle.agentId === agentId) return true
    return false
}

export async function syncAgentStatus(agentId: string): Promise<void> {
    await setAgentStatus(agentId, agentHasLiveRun(agentId) ? 'busy' : 'idle')
}

export function activeRunCount(): number {
    return controllers.size
}

export function sessionClaimCount(): number {
    return sessionClaims.size
}

export function abortRun(runId: string): boolean {
    const handle = controllers.get(runId)
    if (!handle) return false
    controllers.delete(runId)
    releaseSession(runId)
    handle.controller.abort()
    handle.cancel?.()
    return true
}

export function announceToAgentRuns(agentId: string, part: Parameters<UIMessageStreamWriter['write']>[0]): number {
    let written = 0
    for (const handle of controllers.values()) {
        if (handle.agentId !== agentId || !handle.writer) continue
        try {
            handle.writer.write(part)
            written++
        } catch {
            continue
        }
    }
    return written
}
