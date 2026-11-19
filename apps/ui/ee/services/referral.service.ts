import type { Database } from '@/app/api/database.types'
import { resolveMemberIdentities } from '@/app/api/_services/members.service'
import { REFERRAL_FRIENDS_SHOWN, REFERRAL_MONTHS_CAP, REFERRAL_STATUS_ORDER, referralLink, referralStatus, type ReferralOverview } from '@/ee/lib/billing/referral'
import { idOf, legacyBaseDiscountCents, priceArmOfItems, stripe } from '@/ee/lib/billing/stripe'
import { paidPlanInvoiceWorkspace } from '@/ee/services/billing.service'
import { firstNameOf } from '@/ee/services/referral-attach.service'
import { getAppOrigin } from '@/lib/app-origin'
import { slugify } from '@/lib/slugify'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMany, selectMaybeSingle } from '@/supabase/supabase-helpers'
import { planPriceCents, ZERO_QUANTITIES } from '@/ee/lib/billing/plans'
import type { User } from '@supabase/supabase-js'
import type Stripe from 'stripe'

type ReferralUpdate = Database['public']['Tables']['referrals']['Update']

const UNIQUE_VIOLATION = '23505'
const CODE_ATTEMPTS = 6

// A code reads like its owner (`clement`), and takes a number when the name is already someone's.
function candidateCode(user: Pick<User, 'app_metadata' | 'user_metadata' | 'email'>, attempt: number): string {
    const base = slugify(firstNameOf(user) ?? '', { maxLength: 24 }) || 'friend'
    return attempt === 0 ? base : `${base}-${Math.floor(1000 + Math.random() * 9000)}`
}

export async function ensureReferralCode(workspaceId: number, user: Pick<User, 'id' | 'app_metadata' | 'user_metadata' | 'email'>): Promise<string> {
    const supabase = createServiceRoleClient()
    const owned = { workspace_id: workspaceId, user_id: user.id }
    const { data: existing } = await selectMaybeSingle(supabase, 'referral_codes', ['code'] as const, owned)
    if (existing) return existing.code

    for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
        const code = candidateCode(user, attempt)
        const { error } = await supabase.from('referral_codes').insert<Database['public']['Tables']['referral_codes']['Insert']>({ code, ...owned })
        if (!error) return code
        if (error.code !== UNIQUE_VIOLATION) throw error
        // Two tabs opening the pane at once: the other one wrote this member's code first.
        const { data: raced } = await selectMaybeSingle(supabase, 'referral_codes', ['code'] as const, owned)
        if (raced) return raced.code
    }
    throw new Error(`No free referral code for workspace ${workspaceId}`)
}

// Only the friends shown by name cost an auth read each: a link shared widely brings hundreds.
export async function getReferralOverview(workspaceId: number, user: Pick<User, 'id' | 'app_metadata' | 'user_metadata' | 'email'>): Promise<ReferralOverview> {
    const supabase = createServiceRoleClient()
    const [code, origin, referrals] = await Promise.all([
        ensureReferralCode(workspaceId, user),
        getAppOrigin(),
        selectMany(supabase, 'referrals', ['id', 'referee_user_id', 'referee_workspace_id', 'rewarded_at', 'referrer_credit_cents'] as const, { referrer_workspace_id: workspaceId }, { column: 'created_at', ascending: false }),
    ])
    if (referrals.error) throw referrals.error
    const rows = referrals.data ?? []

    const workspaces = rows.length ? await selectMany(supabase, 'workspaces', ['id', 'subscription_status', 'trial_ends_at'] as const, { id: rows.map(row => row.referee_workspace_id) }) : { data: [] }
    const workspaceById = new Map((workspaces.data ?? []).map(workspace => [workspace.id, workspace]))
    const ranked = rows
        .map(row => ({ row, status: referralStatus(row.rewarded_at, workspaceById.get(row.referee_workspace_id) ?? null) }))
        .sort((a, b) => REFERRAL_STATUS_ORDER[a.status] - REFERRAL_STATUS_ORDER[b.status])
    const shown = ranked.slice(0, REFERRAL_FRIENDS_SHOWN)
    const identities = await resolveMemberIdentities(supabase, shown.map(({ row }) => row.referee_user_id))

    return {
        link: referralLink(origin, code),
        monthsEarned: Math.min(REFERRAL_MONTHS_CAP, rows.filter(row => (row.referrer_credit_cents ?? 0) > 0).length),
        cap: REFERRAL_MONTHS_CAP,
        friends: shown.map(({ row, status }) => ({
            id: row.id,
            name: identities.get(row.referee_user_id)?.name ?? null,
            email: identities.get(row.referee_user_id)?.email ?? null,
            status,
        })),
        moreFriends: ranked.length - shown.length,
    }
}

// A month of the plan at the price the subscription was sold on, a legacy price included: a
// subscriber on $49 gets $49 back, not the price the test offers today.
function monthOfSubscription(subscription: Stripe.Subscription): number {
    const items = subscription.items.data
    return Math.max(0, planPriceCents(ZERO_QUANTITIES, 'monthly', priceArmOfItems(items)) - legacyBaseDiscountCents(items))
}

// A negative line on the plan subscription's next invoice: neither a credit pack nor a template,
// which share the customer, can spend it.
async function creditMonth(subscription: Stripe.Subscription, cents: number, referralId: string, side: 'referee' | 'referrer'): Promise<void> {
    const customer = idOf(subscription.customer)
    if (!customer) throw new Error(`Subscription ${subscription.id} has no customer`)
    await stripe.invoiceItems.create(
        { customer, subscription: subscription.id, amount: -cents, currency: 'usd', description: 'Refer a friend: one month free', metadata: { referral_id: referralId, side } },
        { idempotencyKey: `referral-${referralId}-${side}` },
    )
}

// The referrer's plan subscription, null once it ended: there is no invoice left to take a month off.
async function referrerSubscription(workspaceId: number): Promise<Stripe.Subscription | null> {
    const { data } = await selectMaybeSingle(createServiceRoleClient(), 'workspaces', ['stripe_subscription_id'] as const, { id: workspaceId })
    if (!data?.stripe_subscription_id) return null
    const subscription = await stripe.subscriptions.retrieve(data.stripe_subscription_id)
    return subscription.status === 'canceled' || subscription.status === 'incomplete_expired' ? null : subscription
}

// The friend's first real charge for the plan pays both sides a month. Each side is written down as
// soon as Stripe took it, so a retry only does what is left: Stripe's idempotency keys last a day,
// its retries three. `rewarded_at` is the end of it, set once both sides are settled.
// `referrer_credit_cents` is 0 when the referrer gets nothing: the cap reached, or no plan left.
export async function rewardReferral(invoice: Stripe.Invoice): Promise<void> {
    const paid = await paidPlanInvoiceWorkspace(invoice)
    if (!paid) return

    const supabase = createServiceRoleClient()
    const { data: referral, error } = await selectMaybeSingle(
        supabase,
        'referrals',
        ['id', 'referrer_workspace_id', 'referee_credit_cents', 'referrer_credit_cents'] as const,
        { referee_workspace_id: paid.workspaceId, rewarded_at: { isNull: true } },
    )
    if (error) throw error
    if (!referral) return

    if (referral.referee_credit_cents === null) {
        const refereeCents = monthOfSubscription(paid.subscription)
        await creditMonth(paid.subscription, refereeCents, referral.id, 'referee')
        await recordSide(referral.id, { referee_credit_cents: refereeCents }, 'referee_credit_cents')
    }

    if (referral.referrer_credit_cents === null) {
        const { data: earned, error: earnedError } = await selectMany(supabase, 'referrals', ['id'] as const, { referrer_workspace_id: referral.referrer_workspace_id, referrer_credit_cents: { gt: 0 } })
        if (earnedError) throw earnedError
        const subscription = (earned ?? []).length < REFERRAL_MONTHS_CAP ? await referrerSubscription(referral.referrer_workspace_id) : null
        const referrerCents = subscription ? monthOfSubscription(subscription) : 0
        if (subscription) await creditMonth(subscription, referrerCents, referral.id, 'referrer')
        await recordSide(referral.id, { referrer_credit_cents: referrerCents }, 'referrer_credit_cents')
    }

    await recordSide(referral.id, { rewarded_at: new Date().toISOString() }, 'rewarded_at')
}

async function recordSide(referralId: string, payload: ReferralUpdate, column: 'referee_credit_cents' | 'referrer_credit_cents' | 'rewarded_at'): Promise<void> {
    const { error } = await createServiceRoleClient().from('referrals').update<ReferralUpdate>(payload).eq('id', referralId).is(column, null)
    if (error) throw error
}
