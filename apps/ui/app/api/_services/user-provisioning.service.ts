import type { Database, Json } from '@/app/api/database.types'
import { grantRerunTopup } from '@rerun/cloud/billing.server'
import { BASE_PLAN_SLUG, baseLimitsToColumns, SIGNUP_BUDGET_MICROS, type PriceArm } from '@rerun/cloud/billing'
import { randomBlob } from '@/lib/blobs/catalog'
import { DEFAULT_NOTIFICATION_PREFS } from '@/lib/notifications/prefs'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'
import { DEFAULT_LOCALE, type Locale } from '@rerun/i18n'
import type { SupabaseClient, User } from '@supabase/supabase-js'

// Just-in-time provisioning: the first time an authenticated user (real or anonymous) is seen, seed
// their workspace, user row and owner membership. The request client only reads the users row;
// every write goes through the service role, so the browser holds no write on public.users at all
// (an INSERT it could make would let it plant its row on any workspace before this ran). The `id`
// comes from the verified auth user, which is what auth.uid() would have tied it to.
// Answers whether the account is now provisioned and its signup stamped, null when something
// failed and the next request has to try again.
//
// `phoneStep` says whether an account born on this request owes a verified phone number before it
// enters the app: the web asks for one, an invitee and the mobile app do not.
//
// `priceArm` is the arm of the price test a workspace born on this request is frozen on, null to
// leave it out of the test.
//
// `locale` is the language of the request (the visitor's cookie, else the browser): a workspace born
// on it has its coworkers write in that language when they work on their own.
export async function provisionUser(
    supabase: SupabaseClient<Database>,
    user: User,
    { phoneStep, priceArm, locale = DEFAULT_LOCALE }: { phoneStep: boolean; priceArm: PriceArm | null; locale?: Locale },
): Promise<{ signedUp: boolean } | null> {
    const existingUser = await selectMaybeSingle(supabase, 'users', ['id', 'workspace_id', 'signed_up_at'] as const, { id: user.id })

    // Only a query that came back clean can be read as "this user has no row yet". A failed read
    // (a column the deployed code knows and the database does not, a network blip) says nothing
    // about the user, and treating it as unprovisioned mints a throwaway workspace and membership
    // on every single navigation for as long as the failure lasts.
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
            // The plan's credit belongs to the plan: an account with no subscription gets the
            // signup allowance below and nothing else, or a visitor who never pays walks off with
            // five dollars of Rerun credit.
            rerun_budget_micros: 0,
            price_arm: priceArm,
            locale,
        })
        .select()
        .single()

    // Without a workspace the users row cannot satisfy its NOT NULL workspace_id, so bail out
    // and let the next request retry the whole provisioning rather than leave a half-seeded user.
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

    // The workspace is worthless without the user it was seeded for, and a failure that repeats on
    // the next navigation would pile one up per request, so it goes back out with the retry.
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

    // An account created already signed in, a Google sign-up rather than an anonymous visit that
    // was upgraded, never passes through stampSignup: its allowance is granted here.
    if (!user.is_anonymous) {
        await grantRerunTopup(workspace.id, SIGNUP_BUDGET_MICROS)
        if (phoneStep) await requirePhone(user.id)
    }
    return { signedUp: !user.is_anonymous }
}

// Only ever called at the birth of an account, so an older one never gets a row and is never asked.
// A row that is already there is left as it is.
async function requirePhone(userId: string) {
    const { error } = await createServiceRoleClient()
        .from('user_phones')
        .upsert<Database['public']['Tables']['user_phones']['Insert']>({ user_id: userId }, { onConflict: 'user_id', ignoreDuplicates: true })
    if (error) console.error('Error requiring the phone step', error)
}

// An anonymous visitor is provisioned a users row on their first page view and the account dialog
// then upgrades that same auth user in place, so `created_at` says when they first landed, not when
// they signed up. This is the one place both facts are in hand at once, on a query the middleware
// keeps running until the stamp is down: the write happens once in an account's life, and a missed
// one is picked up on the next request. Written with the service role so the column, which decides
// who gets a lifecycle email and when, stays out of reach of the browser. Answers whether the column
// is set once it is done.
async function stampSignup(user: User, signedUpAt: string | null, workspaceId: number, phoneStep: boolean): Promise<boolean> {
    if (user.is_anonymous) return false
    if (signedUpAt) return true
    // Before the stamp, not after: the browser reads the phone row the moment the stamp reaches it
    // through realtime, and a row written later would be missed. Harmless to repeat.
    if (phoneStep) await requirePhone(user.id)
    // Conditional on the column still being empty, and read back: the requests that follow a signup
    // arrive together, each with the row it read before any of them wrote, and only the one whose
    // write landed grants the allowance.
    const { data: stamped, error } = await createServiceRoleClient()
        .from('users')
        .update<Database['public']['Tables']['users']['Update']>({ signed_up_at: new Date().toISOString() })
        .eq('id', user.id)
        .is('signed_up_at', null)
        .select('id')
    if (error) return false
    if (!stamped?.length) return true
    // Same write, same one-shot guard: the allowance is granted exactly when an account stops being
    // anonymous, which is also when the foreman starts talking to it.
    await grantRerunTopup(workspaceId, SIGNUP_BUDGET_MICROS)
    return true
}
