import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

import { sendOrganizationCreditOutEmail } from '@/app/api/_services/email.service'
import type { Database } from '@/app/api/database.types'
import { consoleWorkspacePath } from '@/ee/lib/organizations/console-routes'
import { organizationBrandOfWorkspace } from '@/ee/services/organization-brand.service'
import { getWorkspaceBudget, hasRemainingBudget } from '@/ee/services/rerunBudget.service'
import { brandAppUrl } from '@/lib/brand/urls'
import { BANNER_WARM_BACKGROUND_MS, emailBoardBanner } from '@/lib/email/board-banner'
import { loadEmailRecipient } from '@/lib/email/recipient'
import { recipientLocale } from '@/lib/i18n/recipient-locale'
import { selectAll } from '@/supabase/supabase-helpers'

type Client = SupabaseClient<Database>
type WorkspaceUpdate = Database['public']['Tables']['workspaces']['Update']
type ManagedWorkspace = { id: number; name: string | null; organization_id: string }

// The team of the organization, once each time one of its workspaces runs out: the mark is taken
// before anyone is written to, and the next allocation clears it.
export async function alertOrganizationOutOfCredit(supabase: Client, workspace: ManagedWorkspace): Promise<void> {
    if (!(await takeAlert(supabase, workspace.id))) return

    // Credit handed out since the call was refused.
    const budget = await getWorkspaceBudget(workspace.id)
    if (!budget || hasRemainingBudget(budget)) return clearOrganizationCreditAlert(supabase, workspace.id)

    // Nobody was reached, or it could not even be tried: the next refused call tries again.
    const reached = await emailTeam(supabase, workspace).catch(err => {
        console.error('[organizations] the credit alert of a workspace could not be sent', workspace.id, err)
        return false
    })
    if (!reached) await clearOrganizationCreditAlert(supabase, workspace.id)
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

// Everyone on the team, whatever they chose to hear from Rerun: this is their own service telling them
// a client of theirs has stopped, and an account born on the organization's address hears nothing else.
async function emailTeam(supabase: Client, workspace: ManagedWorkspace): Promise<boolean> {
    const brand = await organizationBrandOfWorkspace(workspace.id)
    if (!brand) return false
    const { data: team, error } = await selectAll(supabase, 'organization_members', ['user_id'] as const, { organization_id: workspace.organization_id })
    if (error) throw new Error(error.message)
    if (team.length === 0) return false

    const appUrl = brandAppUrl(brand)
    const boardUrl = await emailBoardBanner(supabase, workspace.id, 'offline', BANNER_WARM_BACKGROUND_MS, brand)
    const results = await Promise.allSettled(
        team.map(async ({ user_id }) => {
            const recipient = await loadEmailRecipient(supabase, user_id)
            if (!recipient) return false
            const locale = await recipientLocale(supabase, user_id, workspace.id)
            const result = await sendOrganizationCreditOutEmail({ to: recipient.email, workspaceName: workspace.name, consoleUrl: `${appUrl}${consoleWorkspacePath(workspace.id)}`, boardUrl, locale, brand })
            return result.ok
        }),
    )
    return results.some(result => result.status === 'fulfilled' && result.value)
}
