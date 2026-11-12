import 'server-only'

import type { ResponseBodyV2DecodedPayload } from '@apple/app-store-server-library'
import type { Database } from '@/app/api/database.types'
import type { WorkspaceContext } from '@/app/api/_auth/ownership'
import { reconcileAgentActivation, wakePlanLimitedAgents } from '@/app/api/_services/agent-activation.service'
import { markPaymentMethodAdded } from '@/app/api/_services/getting-started.service'
import { syncEnginePlan } from '@/app/api/_services/workspace-engine.service'
import { appleIapConfig, appleServerApiKey, type AppleIapConfig } from '@/ee/lib/billing/apple/config'
import { fetchAppleSubscription } from '@/ee/lib/billing/apple/server-api'
import { acknowledgeGoogleSubscription, fetchGoogleSubscription } from '@/ee/lib/billing/google/client'
import { googlePlayConfig, type GooglePlayConfig } from '@/ee/lib/billing/google/config'
import type { DeveloperNotification } from '@/ee/lib/billing/google/push'
import { GOOGLE_SUBSCRIPTION_REVOKED, googleSubscriptionState, needsAcknowledgement } from '@/ee/lib/billing/google/state'
import { appleSubscriptionState } from '@/ee/lib/billing/apple/state'
import { verifyAppleRenewalInfo, verifyAppleTransaction, type AppleEnvironment, type AppleVerifierOptions } from '@/ee/lib/billing/apple/verify'
import { isMachineEntitled, isSubscriptionEntitled } from '@/ee/lib/billing/entitlement'
import { hasPeriodAdvanced } from '@/ee/lib/billing/period'
import { ZERO_QUANTITIES, isLifetimePlan } from '@/ee/lib/billing/plans'
import { storeProductId } from '@/ee/lib/billing/store/products'
import { STORE_WORKSPACE_COLUMNS, isStaleReading, storeWorkspaceUpdate, type StoreSubscriptionState } from '@/ee/lib/billing/store/subscription-state'
import { syncWorkspaceAppSlots } from '@/lib/apps/slots-sync'
import { randomUuid } from '@/lib/random-uuid'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMany, selectMaybeSingle, selectSingle } from '@/supabase/supabase-helpers'
import { requestAgentActivationSync } from '@/trigger/sync-agent-activation'
import { BILLING_ENABLED } from '@rerun/cloud/billing'
import { requestBoxRestore } from '@rerun/cloud/engines'
import { isStoreProvider, type StoreOffer, type StoreOfferUnavailableReason, type StoreProvider, type StorePurchaseRefusal, type StorePurchaseRequest, type StorePurchaseResult } from '@rerun/contracts'
import { reportStoreSubscriptionTransition } from './billing-analytics.service'

type WorkspaceUpdate = Database['public']['Tables']['workspaces']['Update']

type StoreWorkspace = {
    id: number
    current_period_end: string | null
    subscription_status: string | null
    first_paid_at: string | null
    max_agents: number | null
    max_seats: number | null
    rerun_budget_micros: number
    billing_provider: string | null
    store_subscription_id: string | null
    store_account_token: string | null
    trial_ends_at: string | null
    is_sandbox: boolean
    plan: string
    stripe_subscription_id: string | null
}

// A transaction the hub cannot read: forged, for another app, or for a product it does not sell.
export class InvalidStorePurchaseError extends Error {}

async function loadStoreWorkspace(filter: { id: number } | { store_subscription_id: string } | { store_account_token: string }): Promise<StoreWorkspace | null> {
    const { data } = await selectMaybeSingle(createServiceRoleClient(), 'workspaces', STORE_WORKSPACE_COLUMNS, filter)
    return data
}

// The workspace a subscription belongs to: the one already holding it or the subscription it
// replaces, else the one whose token the app handed to the purchase.
async function workspaceOfSubscription(state: StoreSubscriptionState): Promise<StoreWorkspace | null> {
    const holder = await loadStoreWorkspace({ store_subscription_id: state.subscriptionId })
    if (holder) return holder
    if (state.replacesSubscriptionId) {
        const previous = await loadStoreWorkspace({ store_subscription_id: state.replacesSubscriptionId })
        if (previous) return previous
    }
    if (!state.accountToken) return null
    return loadStoreWorkspace({ store_account_token: state.accountToken.toLowerCase() })
}

// Whether this store subscription may bill the workspace, or something else already does: a Stripe
// plan in force (refuseSecondPlanSubscription's rule, the other way round), the other store, or
// another subscription of the same store. A workspace whose plan has ended takes any of them.
function billingConflict(workspace: StoreWorkspace, provider: StoreProvider, subscription: Pick<StoreSubscriptionState, 'subscriptionId' | 'replacesSubscriptionId'> | null): Extract<StorePurchaseRefusal, 'billed_on_web' | 'other_store'> | null {
    if (!isSubscriptionEntitled(workspace.subscription_status)) return null
    const sameSubscription = !subscription || workspace.store_subscription_id === subscription.subscriptionId || (!!subscription.replacesSubscriptionId && workspace.store_subscription_id === subscription.replacesSubscriptionId)
    if (workspace.billing_provider === provider && sameSubscription) return null
    if (isStoreProvider(workspace.billing_provider)) return 'other_store'
    return 'billed_on_web'
}

function offerRefusal(ctx: WorkspaceContext, workspace: StoreWorkspace, provider: StoreProvider): StoreOfferUnavailableReason | null {
    if (ctx.role === 'member') return 'member'
    if (workspace.is_sandbox) return 'sandbox'
    if (isLifetimePlan(workspace)) return 'lifetime_plan'
    if (isSubscriptionEntitled(workspace.subscription_status) && workspace.billing_provider === provider) return 'subscribed'
    return billingConflict(workspace, provider, null)
}

// GET /api/v1/billing/store. The token is minted on the first visit and kept: every purchase from
// this workspace carries it, whoever the admin and whichever phone.
export async function getStoreOffer(ctx: WorkspaceContext, provider: StoreProvider): Promise<StoreOffer> {
    const productId = storeProductId(provider)
    if (!productId) return { available: false, reason: 'not_sold' }

    const workspace = await loadStoreWorkspace({ id: ctx.workspace.id })
    if (!workspace) return { available: false, reason: 'not_sold' }
    const refusal = offerRefusal(ctx, workspace, provider)
    if (refusal) return { available: false, reason: refusal }

    const accountToken = workspace.store_account_token ?? (await mintAccountToken(workspace.id))
    return { available: true, provider, productId, accountToken, trialEligible: !workspace.trial_ends_at }
}

async function mintAccountToken(workspaceId: number): Promise<string> {
    const supabase = createServiceRoleClient()
    const token = randomUuid()
    // Only written where none is set yet, so two first visits at once agree on the same token.
    await supabase.from('workspaces').update<WorkspaceUpdate>({ store_account_token: token }).eq('id', workspaceId).is('store_account_token', null)
    const { data } = await selectSingle(supabase, 'workspaces', ['store_account_token'] as const, { id: workspaceId })
    if (!data?.store_account_token) throw new Error(`No store account token on workspace ${workspaceId}`)
    return data.store_account_token
}

// What the app sent, read with its store: the state, null for a purchase whose payment is still
// pending, and what to do once it is applied (Google wants every purchase acknowledged).
type StorePurchaseReading = { state: StoreSubscriptionState | null; afterApply: () => Promise<void> }

const NOTHING_AFTER = async () => {}

async function readStorePurchase(request: StorePurchaseRequest, now: Date): Promise<StorePurchaseReading> {
    if (request.store === 'apple') {
        const config = appleIapConfig()
        if (!config) throw new InvalidStorePurchaseError('The App Store is not configured')
        return { state: await readAppleTransaction(config, request.jws, null, now), afterApply: NOTHING_AFTER }
    }
    const config = googlePlayConfig()
    if (!config) throw new InvalidStorePurchaseError('Google Play is not configured')
    if (request.productId !== config.productId) throw new InvalidStorePurchaseError(`Google Play purchase for an unknown product: ${request.productId}`)
    return readGooglePurchase(config, request.purchaseToken, now)
}

export async function readGooglePurchase(config: GooglePlayConfig, purchaseToken: string, now: Date, options: { revoked?: boolean } = {}): Promise<StorePurchaseReading> {
    const purchase = await fetchGoogleSubscription(config, purchaseToken)
    if (!purchase) throw new InvalidStorePurchaseError('Google Play does not know this purchase token')
    const state = googleSubscriptionState(purchaseToken, purchase, config.productId, now, options)
    if (state && state.productId !== config.productId) throw new InvalidStorePurchaseError(`Google Play purchase for an unknown product: ${state.productId}`)
    const afterApply = needsAcknowledgement(purchase) ? () => acknowledgeGoogleSubscription(config, purchaseToken, config.productId) : NOTHING_AFTER
    return { state, afterApply }
}

// A signed transaction and, when Apple sent one beside it, the signed renewal info, both verified.
export async function readAppleTransaction(config: AppleIapConfig, signedTransaction: string, signedRenewalInfo: string | null, now: Date, options?: AppleVerifierOptions): Promise<StoreSubscriptionState> {
    let verified: { payload: Awaited<ReturnType<typeof verifyAppleTransaction>>['payload']; environment: AppleEnvironment }
    try {
        verified = await verifyAppleTransaction(config, signedTransaction, options)
    } catch (err) {
        throw new InvalidStorePurchaseError(`Apple transaction did not verify: ${err instanceof Error ? err.message : String(err)}`)
    }
    const renewal = signedRenewalInfo ? await verifyAppleRenewalInfo(config, verified.environment, signedRenewalInfo, options) : null
    const state = appleSubscriptionState(verified.payload, renewal, verified.environment, now)
    if (state.productId !== config.productId) throw new InvalidStorePurchaseError(`Apple transaction for an unknown product: ${state.productId}`)
    return state
}

// POST /api/v1/billing/store/purchases, by an admin of the workspace. Verifies the transaction with
// the store, ties it to its workspace and applies it on the spot: the build of the onboarding can
// start on the turn that follows, without waiting for the store's notification, which repeats the
// same idempotent write when it lands.
export async function recordStorePurchase(ctx: WorkspaceContext, request: StorePurchaseRequest, now = new Date()): Promise<StorePurchaseResult> {
    if (!storeProductId(request.store)) return { ok: false, reason: 'not_sold' }
    const { state, afterApply } = await readStorePurchase(request, now)
    if (!state) return { ok: false, reason: 'pending' }

    const holder = await workspaceOfSubscription(state)
    if (holder && holder.id !== ctx.workspace.id) {
        // Bought from another workspace (its token) or already running it: that workspace gets it.
        if (!billingConflict(holder, state.provider, state)) {
            await applyStoreState(holder, state, now)
            await afterApply()
        }
        return { ok: false, reason: 'linked_elsewhere' }
    }

    const workspace = holder ?? (await loadStoreWorkspace({ id: ctx.workspace.id }))
    if (!workspace) return { ok: false, reason: 'not_sold' }
    const conflict = billingConflict(workspace, state.provider, state)
    if (conflict) return { ok: false, reason: conflict }
    // A lapsed subscription sent by Restore purchases has nothing left to give a workspace that does
    // not hold it yet.
    if (state.status === 'canceled' && !holder) return { ok: false, reason: 'expired' }

    let status: string | null
    try {
        status = await applyStoreState(workspace, state, now)
    } catch (err) {
        if (err instanceof StoreSubscriptionTakenError) return { ok: false, reason: 'linked_elsewhere' }
        throw err
    }
    if (!isSubscriptionEntitled(status)) return { ok: false, reason: 'expired' }
    await afterApply()
    return { ok: true, entitled: true, status: status ?? state.status }
}

// The unique index on store_subscription_id refused the write: another workspace took the
// subscription between the read and the write.
class StoreSubscriptionTakenError extends Error {}

// Writes a reading onto its workspace, then everything applySubscriptionToWorkspace does after its
// own write for a Stripe subscription: the coworkers switched on or off to fit, the trial's capped
// ones woken by a conversion, the plan pushed to the box, the analytics, the box restored for
// somebody who comes back.
//
// Returns the status the workspace is left with: a stale reading writes nothing and leaves it as it was.
async function applyStoreState(workspace: StoreWorkspace, state: StoreSubscriptionState, now: Date): Promise<string | null> {
    if (isStaleReading(workspace, state)) return workspace.subscription_status
    const supabase = createServiceRoleClient()
    const update = storeWorkspaceUpdate(workspace, state, now)
    const { error } = await supabase.from('workspaces').update<WorkspaceUpdate>(update).eq('id', workspace.id)
    if (error?.code === '23505') throw new StoreSubscriptionTakenError(error.message)
    if (error) throw error

    if (isSubscriptionEntitled(state.status) && state.status !== 'past_due') {
        await syncWorkspaceAppSlots(supabase, workspace.id, ZERO_QUANTITIES, { periodAdvanced: hasPeriodAdvanced(workspace.current_period_end, state.periodEnd) })
        // The store holds the payment method: the checklist's step is done the moment it bills.
        if (!isSubscriptionEntitled(workspace.subscription_status)) await markPaymentMethodAdded(workspace.id)
    }
    await requestAgentActivationSync(await reconcileAgentActivation(workspace.id))
    if (workspace.subscription_status === 'trialing' && state.status === 'active') {
        const { woken } = await wakePlanLimitedAgents(workspace.id)
        await requestAgentActivationSync(woken, { switchOn: true })
    }
    void syncEnginePlan(workspace.id)
    await reportStoreSubscriptionTransition(state, workspace.id, workspace.subscription_status, !!workspace.first_paid_at)
    if (isMachineEntitled(state.status)) await requestBoxRestore(workspace.id)
    return state.status
}

export type StoreApplyOutcome = 'applied' | 'unknown' | 'conflict'

// The store's notification or the sweep's reading, keyed off the subscription alone: no session.
// A subscription no workspace of this hub holds is answered without a write, which is what a hub
// sees of the other environment's purchases (Google sends prod and staging the same notifications).
export async function applyStoreSubscription(state: StoreSubscriptionState, now = new Date()): Promise<StoreApplyOutcome> {
    const workspace = await workspaceOfSubscription(state)
    if (!workspace) return 'unknown'
    if (billingConflict(workspace, state.provider, state)) {
        console.warn(`[store billing] ${state.provider} subscription ${state.subscriptionId} ignored on workspace ${workspace.id}, billed by ${workspace.billing_provider}`)
        return 'conflict'
    }
    try {
        await applyStoreState(workspace, state, now)
    } catch (err) {
        if (err instanceof StoreSubscriptionTakenError) return 'conflict'
        throw err
    }
    return 'applied'
}

// An App Store Server Notification V2, already verified. Every type that carries a transaction is the
// same full-state reading; TEST, a summary of a renewal extension and the consumption requests carry
// none and only need to be acknowledged.
// A Google Play real-time developer notification, already authenticated. It only names the purchase:
// the state is read again from the Play Developer API, then applied and acknowledged. The topic is
// shared by production and staging, so a token this hub does not hold is answered without a write.
export async function handleGooglePlayNotification(config: GooglePlayConfig, notification: DeveloperNotification, now = new Date()): Promise<StoreApplyOutcome | 'ignored'> {
    if (notification.packageName && notification.packageName !== config.packageName) return 'ignored'
    const subscription = notification.subscriptionNotification
    const voided = notification.voidedPurchaseNotification
    // productType 1 is a subscription; a voided one-time product is none of this hub's business.
    const purchaseToken = subscription?.purchaseToken ?? (voided?.productType === 1 ? voided.purchaseToken : undefined)
    if (!purchaseToken) return 'ignored'
    if (subscription?.subscriptionId && subscription.subscriptionId !== config.productId) return 'ignored'

    const revoked = subscription?.notificationType === GOOGLE_SUBSCRIPTION_REVOKED || !!voided
    let reading: StorePurchaseReading
    try {
        reading = await readGooglePurchase(config, purchaseToken, now, { revoked })
    } catch (err) {
        if (err instanceof InvalidStorePurchaseError) return 'unknown'
        throw err
    }
    if (!reading.state) return 'ignored'
    const outcome = await applyStoreSubscription(reading.state, now)
    if (outcome === 'applied') await reading.afterApply()
    return outcome
}

export async function handleAppleNotification(config: AppleIapConfig, notification: ResponseBodyV2DecodedPayload, now = new Date(), options?: AppleVerifierOptions): Promise<StoreApplyOutcome | 'ignored'> {
    const signedTransaction = notification.data?.signedTransactionInfo
    if (!signedTransaction) return 'ignored'
    const state = await readAppleTransaction(config, signedTransaction, notification.data?.signedRenewalInfo ?? null, now, options)
    return applyStoreSubscription(state, now)
}

// --- The hourly sweep: what a missed notification would have said ---

// A notification can be lost (an outage of ours past the store's retries) or sent to the other hub (a
// TestFlight build talks to production while sandbox notifications go to staging). The sweep reads
// the store again for every store subscription whose period is over or ends within the hour, and
// for the ones being retried, applies what it reads, and acknowledges a Google purchase left pending.
const SWEEP_HORIZON_MS = 60 * 60_000

export type StoreSweepResult = { considered: number; applied: number; unchanged: number; failed: string[] }

export type StoreSweepOptions = { workspaceIds?: number[]; dryRun?: boolean; fetchApple?: typeof fetchAppleSubscription; verifierOptions?: AppleVerifierOptions }

export async function sweepStoreSubscriptions(now = new Date(), { workspaceIds, dryRun = false, fetchApple = fetchAppleSubscription, verifierOptions }: StoreSweepOptions = {}): Promise<StoreSweepResult> {
    const result: StoreSweepResult = { considered: 0, applied: 0, unchanged: 0, failed: [] }
    if (!BILLING_ENABLED) return result
    const apple = appleIapConfig()
    const appleKey = appleServerApiKey()
    const google = googlePlayConfig()
    const providers = [...(apple && appleKey ? ['apple'] : []), ...(google ? ['google'] : [])]
    if (!providers.length) return result

    const { data: due } = await selectMany(
        createServiceRoleClient(),
        'workspaces',
        ['id', 'billing_provider', 'store_subscription_id', 'store_environment', 'subscription_status'] as const,
        {
            billing_provider: providers,
            store_subscription_id: { notNull: true },
            subscription_status: ['trialing', 'active', 'past_due'],
            current_period_end: { lte: new Date(now.getTime() + SWEEP_HORIZON_MS).toISOString() },
            ...(workspaceIds?.length ? { id: workspaceIds } : {}),
        },
    )

    async function readAppleSubscription(originalTransactionId: string, environment: string | null): Promise<StorePurchaseReading | null> {
        if (!apple || !appleKey) return null
        const signed = await fetchApple(apple, appleKey, originalTransactionId, environment ?? 'Production')
        if (!signed) return null
        return { state: await readAppleTransaction(apple, signed.signedTransactionInfo, signed.signedRenewalInfo, now, verifierOptions), afterApply: NOTHING_AFTER }
    }

    for (const workspace of due ?? []) {
        result.considered++
        try {
            const reading = workspace.billing_provider === 'google' && google ? await readGooglePurchase(google, workspace.store_subscription_id!, now) : await readAppleSubscription(workspace.store_subscription_id!, workspace.store_environment)
            if (!reading?.state) {
                result.unchanged++
                continue
            }
            if (dryRun) {
                console.info(`[store sweep] workspace ${workspace.id}: ${workspace.subscription_status} -> ${reading.state.status}`)
                continue
            }
            if ((await applyStoreSubscription(reading.state, now)) === 'applied') {
                result.applied++
                await reading.afterApply()
            } else result.unchanged++
        } catch (err) {
            result.failed.push(`${workspace.id}: ${err instanceof Error ? err.message : String(err)}`)
        }
    }
    return result
}
