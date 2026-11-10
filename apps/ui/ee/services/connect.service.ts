import { realEmail } from '@/lib/auth/placeholder-email'
import type Stripe from 'stripe'
import type { Database } from '@/app/api/database.types'
import { getAppOrigin } from '@/lib/app-origin'
import { CREATOR_TERMS_VERSION, creatorTermsMetadata } from '@/ee/lib/billing/consent'
import { stripe } from '@/ee/lib/billing/stripe'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { getServerSession } from '@/supabase/session/getServerSession'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'
import { AppError } from '@/lib/i18n/action-error'

// The creator half of the marketplace. Rerun takes the charge and transfers the creator's share
// afterwards, so the connected account never does anything but receive money.
//
// Neither `country` nor `capabilities` is set when the account is created, and that absence is
// load-bearing: Stripe freezes an account's country the moment the platform names one or requests a
// single capability, which silently made every creator Luxembourgish, like Rerun itself. Left unset,
// Stripe-hosted onboarding asks the creator where they are. The countries it offers and the
// capabilities requested for each one live in the platform's Connect onboarding options, which must
// stay at `transfers` alone: requesting `card_payments` would drag the creator through a much heavier
// onboarding for a capability they never use.

type CreatorAccountInsert = Database['public']['Tables']['creator_accounts']['Insert']
type CreatorAccountUpdate = Database['public']['Tables']['creator_accounts']['Update']

const ACCOUNT_COLUMNS = [
    'stripe_account_id',
    'charges_enabled',
    'payouts_enabled',
    'details_submitted',
    'disabled_reason',
    'requirements_due',
    'country',
    'default_currency',
] as const

// What the payouts panel renders. `state` collapses Stripe's four booleans into the one question
// the creator is actually asking: can I be paid yet, and if not whose move is it.
export type PayoutState = 'not_started' | 'incomplete' | 'pending_verification' | 'restricted' | 'ready'

export type CreatorAccountState = {
    state: PayoutState
    stripeAccountId: string | null
    chargesEnabled: boolean
    payoutsEnabled: boolean
    detailsSubmitted: boolean
    requirementsDue: string[]
    disabledReason: string | null
    country: string | null
    defaultCurrency: string | null
}

const NOT_STARTED: CreatorAccountState = {
    state: 'not_started',
    stripeAccountId: null,
    chargesEnabled: false,
    payoutsEnabled: false,
    detailsSubmitted: false,
    requirementsDue: [],
    disabledReason: null,
    country: null,
    defaultCurrency: null,
}

// Readiness is `payouts_enabled` alone, deliberately. A recipient account holds the `transfers`
// capability and nothing else, so it can never create a charge of its own and `charges_enabled` stays
// false however complete the onboarding is. Gating on it would have kept every paid template
// unsellable for good. The flag is still stored, it is simply not a condition.
function resolveState(row: { charges_enabled: boolean; payouts_enabled: boolean; details_submitted: boolean; disabled_reason: string | null; requirements_due: string[] }): PayoutState {
    if (row.payouts_enabled) return 'ready'
    if (row.disabled_reason) return 'restricted'
    if (!row.details_submitted) return 'incomplete'
    // Everything is submitted and nothing is due: Stripe is still looking at it.
    return row.requirements_due.length > 0 ? 'incomplete' : 'pending_verification'
}

export async function getCreatorAccountState(userId: string): Promise<CreatorAccountState> {
    const supabase = createServiceRoleClient()
    const { data } = await selectMaybeSingle(supabase, 'creator_accounts', ACCOUNT_COLUMNS, { user_id: userId })
    if (!data) return NOT_STARTED

    return {
        state: resolveState(data),
        stripeAccountId: data.stripe_account_id,
        chargesEnabled: data.charges_enabled,
        payoutsEnabled: data.payouts_enabled,
        detailsSubmitted: data.details_submitted,
        requirementsDue: data.requirements_due,
        disabledReason: data.disabled_reason,
        country: data.country,
        defaultCurrency: data.default_currency,
    }
}

// Stripe's `return_url` is not a promise that onboarding finished, and `account.updated` can be
// late or lost, so the panel pulls the truth from Stripe instead of waiting for a webhook. Skipped
// once the account is ready: from then on the row only ever changes through an event.
export async function refreshCreatorAccount(userId: string): Promise<CreatorAccountState> {
    const current = await getCreatorAccountState(userId)
    if (!current.stripeAccountId || current.state === 'ready') return current

    await syncCreatorAccount(await stripe.accounts.retrieve(current.stripeAccountId))
    return getCreatorAccountState(userId)
}

export async function ensureCreatorAccount(userId: string): Promise<string> {
    const supabase = createServiceRoleClient()
    const { data } = await selectMaybeSingle(supabase, 'creator_accounts', ['stripe_account_id'] as const, { user_id: userId })
    if (data?.stripe_account_id) return data.stripe_account_id

    const { session } = await getServerSession()
    const account = await stripe.accounts.create({
        type: 'express',
        email: realEmail(session?.email) ?? undefined,
        business_profile: { product_description: 'Coworker templates sold on the Rerun marketplace' },
        metadata: { user_id: userId, ...creatorTermsMetadata() },
    })

    const { error } = await supabase.from('creator_accounts').insert<CreatorAccountInsert>({ user_id: userId, stripe_account_id: account.id })
    if (error) throw new Error(`Failed to persist the Stripe account: ${error.message}`)

    return account.id
}

// The onboarding link is only ever minted from a deliberate click on "set up payouts", next to the
// notice that says what accepting means, so that click is the acceptance. Accounts created before a
// version bump reaccept here rather than being grandfathered onto terms they never saw.
async function acceptCurrentCreatorTerms(accountId: string): Promise<string> {
    const account = await stripe.accounts.retrieve(accountId)
    if (account.metadata?.creator_terms_version === CREATOR_TERMS_VERSION) return accountId

    await stripe.accounts.update(accountId, { metadata: creatorTermsMetadata() })
    return accountId
}

// Account links are single-use and expire within minutes, so one is minted on every click and none
// is ever stored. `connect=refresh` is what Stripe redirects to when the link has died on the way.
export async function createCreatorOnboardingLink(userId: string): Promise<string> {
    const origin = await getAppOrigin()
    const link = await stripe.accountLinks.create({
        account: await acceptCurrentCreatorTerms(await ensureCreatorAccount(userId)),
        refresh_url: `${origin}/?creator=payouts&connect=refresh`,
        return_url: `${origin}/?creator=payouts`,
        type: 'account_onboarding',
    })
    return link.url
}

// Stripe rejects a login link on an account that never finished onboarding, so the check is here
// rather than in the caller.
export async function createCreatorDashboardLink(userId: string): Promise<string> {
    const account = await getCreatorAccountState(userId)
    if (!account.stripeAccountId || !account.detailsSubmitted) throw new AppError('finishStripeSetup')

    const link = await stripe.accounts.createLoginLink(account.stripeAccountId)
    return link.url
}

// The net Rerun casts under the onboarding options: a creator who submitted everything and still
// holds no `transfers` capability is one whose country is not requesting it, and would otherwise wait
// forever for a payout that can never be enabled. Asking for it only once `details_submitted` is
// true is what makes this safe, since a capability requested any earlier would have frozen their
// country to Rerun's own. They get one more pass through onboarding, not a dead account.
async function ensureTransfersRequested(account: Stripe.Account): Promise<Stripe.Account> {
    if (!account.details_submitted || account.capabilities?.transfers) return account
    return stripe.accounts.update(account.id, { capabilities: { transfers: { requested: true } } })
}

// The `account.updated` handler. Looked up by the Stripe id rather than by metadata, so an account
// edited by hand in the dashboard still lands on the right row.
export async function syncCreatorAccount(account: Stripe.Account): Promise<void> {
    const supabase = createServiceRoleClient()
    const { data: existing } = await selectMaybeSingle(supabase, 'creator_accounts', ['user_id', 'onboarded_at'] as const, { stripe_account_id: account.id })
    if (!existing) return

    const synced = await ensureTransfersRequested(account)
    const detailsSubmitted = !!synced.details_submitted
    const update: CreatorAccountUpdate = {
        charges_enabled: !!synced.charges_enabled,
        payouts_enabled: !!synced.payouts_enabled,
        details_submitted: detailsSubmitted,
        disabled_reason: synced.requirements?.disabled_reason ?? null,
        requirements_due: [...(synced.requirements?.currently_due ?? []), ...(synced.requirements?.past_due ?? [])],
        country: synced.country ?? null,
        default_currency: synced.default_currency ?? null,
        updated_at: new Date().toISOString(),
    }
    if (detailsSubmitted && !existing.onboarded_at) update.onboarded_at = new Date().toISOString()

    await supabase.from('creator_accounts').update<CreatorAccountUpdate>(update).eq('stripe_account_id', account.id)
}

// A creator who revokes the Rerun app from their Stripe dashboard: the account id is still ours but
// nothing can be transferred to it any more.
export async function markCreatorAccountDeauthorized(accountId: string | undefined): Promise<void> {
    if (!accountId) return
    const supabase = createServiceRoleClient()
    await supabase
        .from('creator_accounts')
        .update<CreatorAccountUpdate>({
            charges_enabled: false,
            payouts_enabled: false,
            disabled_reason: 'deauthorized',
            updated_at: new Date().toISOString(),
        })
        .eq('stripe_account_id', accountId)
}

// The gate every paid checkout goes through. The message says nothing about the creator's account:
// it is the buyer who reads it.
export async function requirePayoutReadyAccount(creatorId: string | null): Promise<string> {
    if (!creatorId) throw new AppError('templateNotPurchasableNow')

    const account = await getCreatorAccountState(creatorId)
    if (!account.stripeAccountId || !account.payoutsEnabled) {
        throw new AppError('templateNotPurchasableNow')
    }
    return account.stripeAccountId
}

// The publish gate reads the same fact but must not throw: an incomplete account is a reason to
// refuse a status change, not an error.
export async function isPayoutReady(creatorId: string | null): Promise<boolean> {
    if (!creatorId) return false
    const account = await getCreatorAccountState(creatorId)
    return account.payoutsEnabled
}
