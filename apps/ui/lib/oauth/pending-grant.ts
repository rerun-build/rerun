import 'server-only'
import type { Database, Json } from '@/app/api/database.types'
import type { McpTokenBundle } from '@/lib/engine/client'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'
import { GRANT_TTL_MS, type CallbackGrant, type ConnectTicket } from './mobile-ticket'

type PendingInsert = Database['public']['Tables']['oauth_pending_grants']['Insert']
type PendingUpdate = Database['public']['Tables']['oauth_pending_grants']['Update']

export type ParkedSignIn =
    | { kind: 'mcp'; serverName: string; mcpUrl?: string; token: McpTokenBundle }
    | { kind: 'managed'; key: string; provider: string; serverName: string; token: Pick<McpTokenBundle, 'accessToken' | 'refreshToken' | 'expiresAt' | 'scope'>; email?: string }
    | { kind: 'composio'; key: string; connectedAccountId: string }

const PENDING_COLUMNS = ['jti', 'agent_id', 'workspace_id', 'user_id', 'payload', 'expires_at'] as const

export const SIGN_IN_ALREADY_USED = 'This sign-in link was already used, please retry'
export const SIGN_IN_EXPIRED = 'Sign-in expired, please retry'

export class SignInClaimError extends Error {}

export async function openPendingGrant(ticket: ConnectTicket): Promise<void> {
    const supabase = createServiceRoleClient()
    await supabase.from('oauth_pending_grants').delete().lt('expires_at', new Date().toISOString())
    const { error } = await supabase
        .from('oauth_pending_grants')
        .insert<PendingInsert>({ jti: ticket.jti, agent_id: ticket.agentId, workspace_id: ticket.workspaceId, user_id: ticket.userId, expires_at: new Date(Date.now() + GRANT_TTL_MS).toISOString() })
    if (error?.code === '23505') throw new Error(SIGN_IN_ALREADY_USED)
    if (error) throw new Error(error.message)
}

export async function parkSignIn(grant: CallbackGrant, parked: ParkedSignIn): Promise<void> {
    const { data, error } = await createServiceRoleClient()
        .from('oauth_pending_grants')
        .update<PendingUpdate>({ kind: parked.kind, payload: parked as unknown as Json })
        .eq('jti', grant.jti)
        .eq('agent_id', grant.agentId)
        .is('payload', null)
        .gt('expires_at', new Date().toISOString())
        .select('jti')
    if (error) throw new Error(error.message)
    if (!data?.length) throw new Error(SIGN_IN_EXPIRED)
}

export async function claimSignIn(jti: string, claimant: { agentId: string; workspaceId: number; userId: string }): Promise<ParkedSignIn> {
    const supabase = createServiceRoleClient()
    const { data: row, error } = await selectMaybeSingle(supabase, 'oauth_pending_grants', PENDING_COLUMNS, { jti })
    if (error) throw new Error(error.message)
    if (!row) throw new SignInClaimError(SIGN_IN_EXPIRED)
    await supabase.from('oauth_pending_grants').delete().eq('jti', jti)
    const theirs = row.agent_id === claimant.agentId && row.workspace_id === claimant.workspaceId && row.user_id === claimant.userId
    if (!theirs || row.payload === null || new Date(row.expires_at).getTime() < Date.now()) throw new SignInClaimError(SIGN_IN_EXPIRED)
    return row.payload as unknown as ParkedSignIn
}
