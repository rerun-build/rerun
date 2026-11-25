import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

import { sendOrganizationCreditOutEmail } from '@/app/api/_services/email.service'
import type { Database } from '@/app/api/database.types'
import { organizationBrandOfWorkspace } from '@/ee/services/organization-brand.service'
import { getWorkspaceBudget, hasRemainingBudget } from '@/ee/services/rerunBudget.service'
import { brandAppUrl } from '@/lib/brand/urls'
import { BANNER_WARM_BACKGROUND_MS, emailBoardBanner } from '@/lib/email/board-banner'
import { loadEmailRecipient } from '@/lib/email/recipient'
import { buildUnsubscribeUrl } from '@/lib/email/unsubscribeToken'
import { recipientLocale } from '@/lib/i18n/recipient-locale'
import { wantsCategoryEmail } from '@/lib/notifications/prefs'
import { selectAll, selectMany } from '@/supabase/supabase-helpers'
import type { Brand } from '@rerun/contracts'

type Client = SupabaseClient<Database>
type WorkspaceUpdate = Database['public']['Tables']['workspaces']['Update']
type ManagedWorkspace = { id: number; name: string | null; organization_id: string }

export const organizationWorkspacePath = (workspaceId: number) => `/organization/workspaces/${workspaceId}`

// The team of the organization, once each time one of its workspaces runs out: the mark is taken
// before anyone is written to, and the next allocation clears it.
export async function alertOrganizationOutOfCredit(supabase: Client, workspace: ManagedWorkspace): Promise<void> {
    if (!(await takeAlert(supabase, workspace.id))) return

    // Credit handed out since the call was refused.
    const budget = await getWorkspaceBudget(workspace.id)
    if (!budget || hasRemainingBudget(budget)) return clearOrganizationCreditAlert(supabase, workspace.id)

    const brand = await organizationBrandOfWorkspace(workspace.id)
    const sent = brand ? await emailTeam(supabase, workspace, brand) : []
    // Nobody was reached: the next refused call tries again.
    if (sent.length > 0 && sent.every(reached => !reached)) await clearOrganizationCreditAlert(supabase, workspace.id)
}

async function takeAlert(supabase: Client, workspaceId: number): Promise<boolean> {
    const { data, error } = await supabase
        .from('workspaces')
        .update<WorkspaceUpdate>({ organization_credit_alerted_at: new Date().toISOString() })
        .eq('id', workspaceId)
        .is('organization_credit_alerted_at', null)
        .select('id')
    if (error) throw new Error(error.message)
    return (data ?? []).length > 0
}

export async function clearOrganizationCreditAlert(supabase: Client, workspaceId: number): Promise<void> {
    const { error } = await supabase.from('workspaces').update<WorkspaceUpdate>({ organization_credit_alerted_at: null }).eq('id', workspaceId)
    if (error) throw new Error(error.message)
}

async function emailTeam(supabase: Client, workspace: ManagedWorkspace, brand: Brand): Promise<boolean[]> {
    const { data: team, error } = await selectAll(supabase, 'organization_members', ['user_id'] as const, { organization_id: workspace.organization_id })
    if (error) throw new Error(error.message)
    const ids = team.map(member => member.user_id)
    if (ids.length === 0) return []
    const { data: users, error: usersError } = await selectMany(supabase, 'users', ['id', 'email_notification_prefs'] as const, { id: ids })
    if (usersError) throw new Error(usersError.message)
    const recipients = (users ?? []).filter(user => wantsCategoryEmail(user.email_notification_prefs, 'billing'))
    if (recipients.length === 0) return []

    const appUrl = brandAppUrl(brand)
    const boardUrl = await emailBoardBanner(supabase, workspace.id, 'offline', BANNER_WARM_BACKGROUND_MS, brand)
    const results = await Promise.allSettled(
        recipients.map(async ({ id }) => {
            const recipient = await loadEmailRecipient(supabase, id)
            if (!recipient) return false
            const locale = await recipientLocale(supabase, id, workspace.id)
            const result = await sendOrganizationCreditOutEmail({ to: recipient.email, workspaceName: workspace.name, consoleUrl: `${appUrl}${organizationWorkspacePath(workspace.id)}`, boardUrl, unsubscribeUrl: `${buildUnsubscribeUrl(id, appUrl)}&category=billing`, locale, brand })
            return result.ok
        }),
    )
    return results.map(result => result.status === 'fulfilled' && result.value)
}
