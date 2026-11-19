import type { Database, Json } from '@/app/api/database.types'
import { grantRerunTopup } from '@moldwright/cloud/billing.server'
import { BASE_PLAN_SLUG, baseLimitsToColumns, SIGNUP_BUDGET_MICROS, type PriceArm } from '@moldwright/cloud/billing'
import { randomBlob } from '@/lib/blobs/catalog'
import { DEFAULT_NOTIFICATION_PREFS } from '@/lib/notifications/prefs'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'
import { DEFAULT_LOCALE, type Locale } from '@moldwright/i18n'
import type { SupabaseClient, User } from '@supabase/supabase-js'

export async function provisionUser(
    supabase: SupabaseClient<Database>,
    user: User,
    { phoneStep, priceArm, locale = DEFAULT_LOCALE }: { phoneStep: boolean; priceArm: PriceArm | null; locale?: Locale },
): Promise<{ signedUp: boolean } | null> {
    const existingUser = await selectMaybeSingle(supabase, 'users', ['id', 'workspace_id', 'signed_up_at'] as const, { id: user.id })

    if (existingUser.error) {
        console.error('Error reading user for provisioning', existingUser.error)
        return null
    }

    if (existingUser.data) {
        return { signedUp: await stampSignup(user, existingUser.data.signed_up_at, existingUser.data.workspace_id, phoneStep) }
    }

    const serviceSupabase = createServiceRoleClient()

    const { data: workspace, error: workspaceError } = await serviceSupabase
        .from('workspaces')
        .insert<Database['public']['Tables']['workspaces']['Insert']>({
            name: 'My workspace',
            icon_url: randomBlob()?.url ?? null,
            plan: BASE_PLAN_SLUG,
            ...baseLimitsToColumns(),
            rerun_budget_micros: 0,
            price_arm: priceArm,
            locale,
        })
        .select()
        .single()

    if (workspaceError || !workspace) {
        console.error('Error creating workspace', workspaceError)
        return null
    }

    const { error: userError } = await serviceSupabase.from('users').insert<Database['public']['Tables']['users']['Insert']>({
        id: user.id,
        workspace_id: workspace.id,
        email_notification_prefs: DEFAULT_NOTIFICATION_PREFS as unknown as Json,
        signed_up_at: user.is_anonymous ? null : new Date().toISOString(),
    })

    if (userError) {
        console.error('Error creating user', userError)
        await serviceSupabase.from('workspaces').delete().eq('id', workspace.id)
        return null
    }

    const { error: membershipError } = await serviceSupabase.from('workspace_members').insert<Database['public']['Tables']['workspace_members']['Insert']>({
        user_id: user.id,
        workspace_id: workspace.id,
        role: 'admin',
    })
    if (membershipError) console.error('Error creating membership', membershipError)

    if (!user.is_anonymous) {
        await grantRerunTopup(workspace.id, SIGNUP_BUDGET_MICROS)
        if (phoneStep) await requirePhone(user.id)
    }
    return { signedUp: !user.is_anonymous }
}

async function requirePhone(userId: string) {
    const { error } = await createServiceRoleClient()
        .from('user_phones')
        .upsert<Database['public']['Tables']['user_phones']['Insert']>({ user_id: userId }, { onConflict: 'user_id', ignoreDuplicates: true })
    if (error) console.error('Error requiring the phone step', error)
}

async function stampSignup(user: User, signedUpAt: string | null, workspaceId: number, phoneStep: boolean): Promise<boolean> {
    if (user.is_anonymous) return false
    if (signedUpAt) return true
    if (phoneStep) await requirePhone(user.id)
    const { data: stamped, error } = await createServiceRoleClient()
        .from('users')
        .update<Database['public']['Tables']['users']['Update']>({ signed_up_at: new Date().toISOString() })
        .eq('id', user.id)
        .is('signed_up_at', null)
        .select('id')
    if (error) return false
    if (!stamped?.length) return true
    await grantRerunTopup(workspaceId, SIGNUP_BUDGET_MICROS)
    return true
}
