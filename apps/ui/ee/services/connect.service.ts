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

function resolveState(row: { charges_enabled: boolean; payouts_enabled: boolean; details_submitted: boolean; disabled_reason: string | null; requirements_due: string[] }): PayoutState {
    if (row.payouts_enabled) return 'ready'
    if (row.disabled_reason) return 'restricted'
    if (!row.details_submitted) return 'incomplete'
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

async function acceptCurrentCreatorTerms(accountId: string): Promise<string> {
    const account = await stripe.accounts.retrieve(accountId)
    if (account.metadata?.creator_terms_version === CREATOR_TERMS_VERSION) return accountId

    await stripe.accounts.update(accountId, { metadata: creatorTermsMetadata() })
    return accountId
}

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

export async function createCreatorDashboardLink(userId: string): Promise<string> {
    const account = await getCreatorAccountState(userId)
    if (!account.stripeAccountId || !account.detailsSubmitted) throw new AppError('finishStripeSetup')

    const link = await stripe.accounts.createLoginLink(account.stripeAccountId)
    return link.url
}

async function ensureTransfersRequested(account: Stripe.Account): Promise<Stripe.Account> {
    if (!account.details_submitted || account.capabilities?.transfers) return account
    return stripe.accounts.update(account.id, { capabilities: { transfers: { requested: true } } })
}

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

export async function requirePayoutReadyAccount(creatorId: string | null): Promise<string> {
    if (!creatorId) throw new AppError('templateNotPurchasableNow')

    const account = await getCreatorAccountState(creatorId)
    if (!account.stripeAccountId || !account.payoutsEnabled) {
        throw new AppError('templateNotPurchasableNow')
    }
    return account.stripeAccountId
}

export async function isPayoutReady(creatorId: string | null): Promise<boolean> {
    if (!creatorId) return false
    const account = await getCreatorAccountState(creatorId)
    return account.payoutsEnabled
}
