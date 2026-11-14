import { open, seal } from '@/lib/oauth/mobile-ticket'

type ClaudeSignInTicket = { kind: 'claude-sign-in'; userId: string; verifier: string; state: string; exp: number }
type CodexSignInTicket = { kind: 'codex-sign-in'; userId: string; deviceAuthId: string; userCode: string; exp: number }

const CLAUDE_TTL_MS = 15 * 60_000
const CODEX_TTL_MS = 20 * 60_000
const SOMEONE_ELSE = 'This sign-in was started from another account. Start it again.'

export function mintClaudeSignIn(userId: string, pkce: { verifier: string; state: string }): string {
    return seal({ kind: 'claude-sign-in', userId, verifier: pkce.verifier, state: pkce.state }, CLAUDE_TTL_MS)
}

export function openClaudeSignIn(ticket: string, userId: string): { verifier: string; state: string } {
    const claims = open<ClaudeSignInTicket>(ticket, 'sign-in')
    if (claims.kind !== 'claude-sign-in') throw new Error('Invalid sign-in')
    if (claims.userId !== userId) throw new Error(SOMEONE_ELSE)
    return { verifier: claims.verifier, state: claims.state }
}

export function mintCodexSignIn(userId: string, device: { deviceAuthId: string; userCode: string }): string {
    return seal({ kind: 'codex-sign-in', userId, deviceAuthId: device.deviceAuthId, userCode: device.userCode }, CODEX_TTL_MS)
}

export function openCodexSignIn(ticket: string, userId: string): { deviceAuthId: string; userCode: string } {
    const claims = open<CodexSignInTicket>(ticket, 'sign-in')
    if (claims.kind !== 'codex-sign-in') throw new Error('Invalid sign-in')
    if (claims.userId !== userId) throw new Error(SOMEONE_ELSE)
    return { deviceAuthId: claims.deviceAuthId, userCode: claims.userCode }
}
