import { open, openPrivate, seal, sealPrivate } from '@/lib/oauth/mobile-ticket'

// What a subscription sign-in keeps between its two hub calls: the PKCE pair of a Claude sign-in, the
// device code of a Codex one. Sealed and handed to the app rather than kept in a table, and bound to
// the person who started it: a code pasted or a device auth polled by someone else goes nowhere.
type ClaudeSignInTicket = { kind: 'claude-sign-in'; userId: string; verifier: string; state: string; exp: number }
type CodexSignInTicket = { kind: 'codex-sign-in'; userId: string; deviceAuthId: string; userCode: string; exp: number }
type GrokSignInTicket = { kind: 'grok-sign-in'; userId: string; workspaceId: number; deviceCode: string; exp: number }

// Claude shows a code the person copies by hand; OpenAI's device auth lives about fifteen minutes.
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

// xAI's device code is the sign-in itself until it is approved: the ticket is encrypted, and bound to
// the workspace too, so an approval lands on the connection list it was started from and no other.
// It lives as long as xAI's code, plus the time a last poll takes.
const GROK_TTL_GRACE_MS = 2 * 60_000
const ANOTHER_WORKSPACE = 'This sign-in was started from another workspace. Start it again.'

export function mintGrokSignIn(userId: string, workspaceId: number, device: { deviceCode: string; expiresAt: number }): string {
    return sealPrivate({ kind: 'grok-sign-in', userId, workspaceId, deviceCode: device.deviceCode }, device.expiresAt - Date.now() + GROK_TTL_GRACE_MS)
}

export function openGrokSignIn(ticket: string, userId: string, workspaceId: number): { deviceCode: string } {
    const claims = openPrivate<GrokSignInTicket>(ticket, 'sign-in')
    if (claims.kind !== 'grok-sign-in') throw new Error('Invalid sign-in')
    if (claims.userId !== userId) throw new Error(SOMEONE_ELSE)
    if (claims.workspaceId !== workspaceId) throw new Error(ANOTHER_WORKSPACE)
    return { deviceCode: claims.deviceCode }
}
