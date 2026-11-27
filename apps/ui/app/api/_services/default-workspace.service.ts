import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database, Json } from '@/app/api/database.types'
import { BASE_PLAN_SLUG, baseLimitsToColumns } from '@rerun/cloud/billing'
import { randomBlob } from '@/lib/blobs/catalog'
import { ensureForemanAgentRow } from '@/lib/foreman/agent-row'
import { DEFAULT_WORKSPACE_NAME } from '@/lib/naming/workspace-name'
import { mergeNotificationPrefs, normalizeNotificationPrefs } from '@/lib/notifications/prefs'
import { selectMany, selectMaybeSingle } from '@/supabase/supabase-helpers'
import { DEFAULT_LOCALE, isStableLocale, type Locale } from '@rerun/i18n'

type Client = SupabaseClient<Database>

// The workspace of someone who has none. The plan's credit belongs to the plan: with no subscription
// there is none, or a visitor who never pays walks off with it.
export function insertDefaultWorkspace(supabase: Client, { locale }: { locale: Locale }) {
    return supabase
        .from('workspaces')
        .insert<Database['public']['Tables']['workspaces']['Insert']>({
            name: DEFAULT_WORKSPACE_NAME,
            icon_url: randomBlob()?.url ?? null,
            plan: BASE_PLAN_SLUG,
            ...baseLimitsToColumns(),
            rerun_budget_micros: 0,
            locale,
        })
        .select()
        .single()
}

// A workspace opened for someone who never came to Rerun for one, the team of an organization or a
// client it let go: Rerun writes them no email about it.
export const NO_RERUN_EMAIL = { categories: { product: false, billing: false } }

async function openDefaultWorkspace(supabase: Client, userId: string): Promise<number> {
    const { data: user } = await selectMaybeSingle(supabase, 'users', ['locale', 'email_notification_prefs'] as const, { id: userId })
    const { data: workspace, error } = await insertDefaultWorkspace(supabase, { locale: isStableLocale(user?.locale) ? user.locale : DEFAULT_LOCALE })
    if (error || !workspace) throw new Error(`Could not open a workspace for ${userId}: ${error?.message}`)

    const { error: memberError } = await supabase.from('workspace_members').insert<Database['public']['Tables']['workspace_members']['Insert']>({ user_id: userId, workspace_id: workspace.id, role: 'admin' })
    if (memberError) {
        await supabase.from('workspaces').delete().eq('id', workspace.id)
        throw new Error(memberError.message)
    }
    await ensureForemanAgentRow(supabase, workspace.id).catch(err => console.error('[workspace] failed to write the Chief of Staff', err))
    const quiet = mergeNotificationPrefs(normalizeNotificationPrefs(user?.email_notification_prefs), NO_RERUN_EMAIL) as unknown as Json
    const { error: prefsError } = await supabase.from('users').update<Database['public']['Tables']['users']['Update']>({ email_notification_prefs: quiet }).eq('id', userId)
    if (prefsError) console.error('[workspace] the emails of an account given a workspace stayed on', userId, prefsError)
    return workspace.id
}

// Their own workspaces before the ones they only run for an organization.
async function otherWorkspaceOf(supabase: Client, userId: string, leaving: number): Promise<number | null> {
    const { data, error } = await selectMany(supabase, 'workspace_members', ['workspace_id', 'organization_staff'] as const, { user_id: userId, workspace_id: { neq: leaving } }, { column: 'created_at' })
    if (error) throw new Error(error.message)
    const others = data ?? []
    return (others.find(other => !other.organization_staff) ?? others[0])?.workspace_id ?? null
}

// Points an account away from a workspace it is about to lose: `users.workspace_id` deletes the
// account along with the workspace. False when they have no other and none may be opened for them.
export async function moveToOtherWorkspace(supabase: Client, userId: string, leaving: number, { openOne }: { openOne: boolean }): Promise<boolean> {
    const { data: user, error: userError } = await selectMaybeSingle(supabase, 'users', ['workspace_id'] as const, { id: userId })
    if (userError) throw new Error(userError.message)
    if (user?.workspace_id !== leaving) return true

    const target = (await otherWorkspaceOf(supabase, userId, leaving)) ?? (openOne ? await openDefaultWorkspace(supabase, userId) : null)
    if (target === null) return false
    const { error } = await supabase.from('users').update<Database['public']['Tables']['users']['Update']>({ workspace_id: target }).eq('id', userId).eq('workspace_id', leaving)
    if (error) throw new Error(error.message)
    return true
}
