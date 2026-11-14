import 'server-only'

import type { Database } from '@/app/api/database.types'
import { isWorkspaceApiEntitled } from '@rerun/cloud/billing'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'
import { createHash, randomBytes } from 'node:crypto'

const KEY_PREFIX = 'rk_'
const KEY_BYTES = 30
const DISPLAY_PREFIX_LENGTH = 12
const ACTIVITY_STAMP_INTERVAL_MS = 60 * 60_000

const API_KEY_AUTH_COLUMNS = ['id', 'workspace_id', 'revoked_at', 'created_by_user_id', 'expires_at', 'scope', 'bound_agent_id'] as const

export type ApiKeyScope = 'account' | 'agent_import'

export type AuthenticatedApiKey = {
    keyId: string
    workspaceId: number
    createdByUserId: string | null
    scope: ApiKeyScope
    boundAgentId: string | null
}

export function generateApiKey(): string {
    return KEY_PREFIX + randomBytes(KEY_BYTES).toString('base64url')
}

export function hashApiKey(key: string): string {
    return createHash('sha256').update(key).digest('hex')
}

export function apiKeyPrefix(key: string): string {
    return key.slice(0, DISPLAY_PREFIX_LENGTH)
}

async function stampSandboxActivity(workspaceId: number): Promise<void> {
    try {
        const staleBefore = new Date(Date.now() - ACTIVITY_STAMP_INTERVAL_MS).toISOString()
        await createServiceRoleClient()
            .from('workspaces')
            .update<Database['public']['Tables']['workspaces']['Update']>({ last_active_at: new Date().toISOString() })
            .eq('id', workspaceId)
            .eq('is_sandbox', true)
            .or(`last_active_at.is.null,last_active_at.lt.${staleBefore}`)
    } catch {}
}

export async function authenticateApiKey(token: string): Promise<AuthenticatedApiKey | null> {
    if (!token.startsWith(KEY_PREFIX)) return null

    const supabase = createServiceRoleClient()
    const { data } = await selectMaybeSingle(supabase, 'api_keys', API_KEY_AUTH_COLUMNS, { key_hash: hashApiKey(token) })
    if (!data || data.revoked_at) return null
    if (data.expires_at && Date.parse(data.expires_at) <= Date.now()) return null

    const { data: workspace } = await selectMaybeSingle(supabase, 'workspaces', ['subscription_status', 'is_sandbox'] as const, { id: data.workspace_id })
    if (!workspace || !isWorkspaceApiEntitled(workspace)) return null

    supabase
        .from('api_keys')
        .update<Database['public']['Tables']['api_keys']['Update']>({ last_used_at: new Date().toISOString() })
        .eq('id', data.id)
        .then(
            () => undefined,
            () => undefined,
        )

    void stampSandboxActivity(data.workspace_id)

    return {
        keyId: data.id,
        workspaceId: data.workspace_id,
        createdByUserId: data.created_by_user_id,
        scope: data.scope === 'agent_import' ? 'agent_import' : 'account',
        boundAgentId: data.bound_agent_id,
    }
}

export async function bindImportKey(keyId: string, agentId: string): Promise<boolean> {
    const { data, error } = await createServiceRoleClient()
        .from('api_keys')
        .update<Database['public']['Tables']['api_keys']['Update']>({ bound_agent_id: agentId })
        .eq('id', keyId)
        .eq('scope', 'agent_import')
        .is('bound_agent_id', null)
        .select('id')
    if (error) throw new Error(error.message)
    return (data ?? []).length > 0
}
