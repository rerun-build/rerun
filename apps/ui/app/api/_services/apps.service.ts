import 'server-only'
import type Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'
import { PLAN_PRICES_CENTS, TRIAL_DAYS } from '@rerun/contracts'
import { assertAgentInWorkspace } from '@/app/api/_auth/access'
import { AuthorizationError, requireWorkspaceContext } from '@/app/api/_auth/ownership'
import type { Database } from '@/app/api/database.types'
import { getWorkspaceConnection } from '@/app/api/_services/workspace-engine.service'
import { reportWorkspaceEvent } from '@/lib/apps/analytics'
import { dropWakeTrigger } from '@/lib/apps/bindings'
import { claimQuota, updateConnection, workspaceScope } from '@/lib/apps/connections'
import { isWakeEventOf } from '@/lib/apps/catalog'
import { loginLinkedin, type LinkedinCredentials } from '@/lib/apps/linkedin/connect'
import { loginWhatsapp } from '@/lib/apps/whatsapp/connect'
import { LinkupError, createWebhook, deleteAccount, resendCheckpointCode, submitCheckpoint, type LinkupLinkCode, type LinkupLoginResult } from '@/lib/apps/linkup/client'
import { linkupNamespace } from '@/lib/apps/linkup/namespace'
import { DAILY_LOGIN_ATTEMPT_LIMIT, dayKey } from '@/lib/apps/quotas'
import { appDefinition } from '@/lib/apps/registry'
import { canRemoveSlot, connectAllowance, type ConnectAllowance } from '@/lib/apps/slots'
import { SLOT_PAUSE_REASONS, subscriberTrialOpen } from '@/lib/apps/slots-sync'
import { addPaidSlot, addTrialSlot, slotQuantity } from '@/lib/apps/stripe-slots'
import { APP_CONNECTION_COLUMNS, SLOT_HOLDING_STATUSES, type AppConnectionStatus, type AppSlug } from '@/lib/apps/types'
import { isMachineEntitled } from '@/ee/lib/billing/entitlement'
import { intervalOfItems, stripe } from '@/ee/lib/billing/stripe'
import { createTrigger as engineCreateTrigger } from '@/lib/engine/client'
import { site } from '@/lib/site'
import { AppError, type ErrorCode, type ErrorParams } from '@/lib/i18n/action-error'
import { selectMany, selectMaybeSingle } from '@/supabase/supabase-helpers'

type Client = SupabaseClient<Database>
type ConnectionInsert = Database['public']['Tables']['app_connections']['Insert']
type WorkspaceAppInsert = Database['public']['Tables']['workspace_apps']['Insert']
type WorkspaceAppUpdate = Database['public']['Tables']['workspace_apps']['Update']
type TrialClaimInsert = Database['public']['Tables']['app_trial_claims']['Insert']
type BindingInsert = Database['public']['Tables']['app_connection_agents']['Insert']
type BindingUpdate = Database['public']['Tables']['app_connection_agents']['Update']

// Every account carries the environment it was created from: one Linkup key serves them all, and
// each reconciliation only judges its own.
function linkupAccountName(connectionId: string): string {
    return `${linkupNamespace()}:${connectionId}`
}

function webhookUrl(): string {
    return `${(process.env.NEXT_PUBLIC_APP_URL ?? site.url).replace(/\/$/, '')}/api/webhooks/linkup`
}

export type AppRefusalReason = 'needs_slot' | 'not_entitled' | 'paused' | 'too_many_attempts' | 'refused' | 'trial_used' | 'duplicate' | 'unknown'

// `reason` is what the dialog acts on (back to the accounts, stop polling), `code` what it reads out.
export class AppActionError extends AppError {
    constructor(
        readonly reason: AppRefusalReason,
        code: ErrorCode,
        params?: ErrorParams,
    ) {
        super(code, params)
        this.name = 'AppActionError'
    }
}

// --- Reading the workspace's state ---

type SlotState = {
    workspaceId: number
    subscription: Stripe.Subscription | null
    stripeSlots: number
    workspaceTrialing: boolean
    app: { slots: number; status: string; trial_ends_at: string | null; trial_settled_at: string | null } | null
    holding: { id: string; status: string; pause_reason: string | null }[]
    trialClaimed: boolean
    boxesArchived: boolean
    subscriptionStatus: string | null
}

async function readSlotState(supabase: Client, workspaceId: number, slug: AppSlug): Promise<SlotState> {
    const [{ data: workspace }, { data: app }, { data: holding }, { data: claim }] = await Promise.all([
        selectMaybeSingle(supabase, 'workspaces', ['stripe_subscription_id', 'subscription_status', 'boxes_archived_at'] as const, { id: workspaceId }),
        selectMaybeSingle(supabase, 'workspace_apps', ['slots', 'status', 'trial_ends_at', 'trial_settled_at'] as const, { workspace_id: workspaceId, app_slug: slug }),
        selectMany(supabase, 'app_connections', ['id', 'status', 'pause_reason'] as const, { workspace_id: workspaceId, app_slug: slug, status: [...SLOT_HOLDING_STATUSES] }),
        selectMaybeSingle(supabase, 'app_trial_claims', ['id'] as const, { workspace_id: workspaceId, app_slug: slug }),
    ])
    const subscription = workspace?.stripe_subscription_id ? await stripe.subscriptions.retrieve(workspace.stripe_subscription_id) : null
    return {
        workspaceId,
        subscription,
        stripeSlots: subscription ? slotQuantity(subscription, appDefinition(slug).addonKey) : 0,
        workspaceTrialing: subscription?.status === 'trialing',
        app: app ?? null,
        holding: holding ?? [],
        trialClaimed: !!claim,
        boxesArchived: !!workspace?.boxes_archived_at,
        subscriptionStatus: workspace?.subscription_status ?? null,
    }
}

function allowanceOf(state: SlotState, excludeConnectionId?: string): ConnectAllowance {
    return connectAllowance({
        workspaceTrialing: state.workspaceTrialing,
        stripeSlots: state.stripeSlots,
        liveConnections: state.holding.filter(connection => connection.id !== excludeConnectionId).length,
        subscriberTrialOpen: subscriberTrialOpen(state.app),
        subscriberTrialAvailable: !state.trialClaimed && !state.app?.trial_ends_at,
    })
}

export type AppConnectionView = {
    id: string
    label: string | null
    status: AppConnectionStatus
    pauseReason: string | null
    pausedUntil: string | null
    createdAt: string
    agents: { id: string; name: string }[]
}

export type AppsOverview = {
    slug: AppSlug
    name: string
    stripeSlots: number
    heldSlots: number
    slotPriceCents: number
    interval: 'monthly' | 'yearly'
    workspaceTrialing: boolean
    subscribed: boolean
    paused: boolean
    subscriberTrialEndsAt: string | null
    allowance: ConnectAllowance
    // The accounts a paid slot holds: the subscriber trial's and the ones paused for want of a slot
    // are not on the bill, so they do not hold the billing dialog's "−" back.
    slotsInUse: number
    canRemoveSlot: boolean
    connections: AppConnectionView[]
}

export async function getAppsOverview(slug: AppSlug): Promise<AppsOverview> {
    const { workspace, supabase } = await requireWorkspaceContext()
    const state = await readSlotState(supabase, workspace.id, slug)
    const { data: rows } = await selectMany(supabase, 'app_connections', APP_CONNECTION_COLUMNS, { workspace_id: workspace.id, app_slug: slug, status: [...SLOT_HOLDING_STATUSES] }, { column: 'created_at', ascending: true })
    const connections = rows ?? []
    const { data: bindings } = connections.length ? await selectMany(supabase, 'app_connection_agents', ['agent_id', 'connection_id'] as const, { connection_id: connections.map(connection => connection.id) }) : { data: [] }
    const { data: agents } = bindings?.length ? await selectMany(supabase, 'agents', ['id', 'name'] as const, { id: bindings.map(binding => binding.agent_id) }) : { data: [] }
    const nameOf = new Map((agents ?? []).map(agent => [agent.id, agent.name]))
    const interval = state.subscription ? intervalOfItems(state.subscription.items.data) : 'monthly'
    const slotsInUse = Math.max(0, state.holding.filter(connection => !(connection.status === 'paused' && (SLOT_PAUSE_REASONS as readonly string[]).includes(connection.pause_reason ?? ''))).length - (subscriberTrialOpen(state.app) ? 1 : 0))

    return {
        slug,
        name: appDefinition(slug).name,
        stripeSlots: state.stripeSlots,
        heldSlots: state.app?.slots ?? state.stripeSlots,
        slotPriceCents: PLAN_PRICES_CENTS[interval][appDefinition(slug).addonKey],
        interval,
        workspaceTrialing: state.workspaceTrialing,
        subscribed: !!state.subscription && isMachineEntitled(state.subscriptionStatus),
        paused: state.boxesArchived || state.app?.status === 'frozen',
        subscriberTrialEndsAt: subscriberTrialOpen(state.app) ? state.app?.trial_ends_at ?? null : null,
        allowance: allowanceOf(state),
        slotsInUse,
        canRemoveSlot: canRemoveSlot(state.stripeSlots, slotsInUse),
        connections: connections.map(connection => ({
            id: connection.id,
            label: connection.label,
            status: connection.status as AppConnectionStatus,
            pauseReason: connection.pause_reason,
            pausedUntil: connection.paused_until,
            createdAt: connection.created_at,
            agents: (bindings ?? []).filter(binding => binding.connection_id === connection.id).map(binding => ({ id: binding.agent_id, name: nameOf.get(binding.agent_id) ?? 'Coworker' })),
        })),
    }
}

// --- Buying a slot ---

// Through the same terms as the billing dialog: a paid workspace is charged the prorated slot now,
// a workspace on its trial gets its one slot at $0, billed with the plan.
export async function addAppSlot(slug: AppSlug, requestId: string): Promise<{ trialSlot: boolean }> {
    const { workspace, supabase } = await requireWorkspaceContext()
    const state = await readSlotState(supabase, workspace.id, slug)
    const app = appDefinition(slug)
    if (!state.subscription || !isMachineEntitled(state.subscriptionStatus)) throw new AppActionError('not_entitled', 'appSubscribeToAddSlot', { provider: app.providerLabel })
    if (state.boxesArchived) throw new AppActionError('paused', 'workspacePaused')

    if (state.workspaceTrialing) {
        if (state.stripeSlots > 0) throw new AppActionError('needs_slot', 'appTrialOneSlot', { provider: app.providerLabel })
        await addTrialSlot(state.subscription, app.addonKey, `trial-slot-${requestId}`)
        await reportWorkspaceEvent(supabase, workspace.id, 'app_slot_added', { app: slug, trial_slot: true })
        return { trialSlot: true }
    }
    await addPaidSlot(state.subscription, app.addonKey, `slot-${requestId}`)
    await reportWorkspaceEvent(supabase, workspace.id, 'app_slot_added', { app: slug, trial_slot: false })
    return { trialSlot: false }
}

// --- Connecting an account ---

export type ConnectOutcome =
    | { status: 'connected'; connectionId: string; label: string | null; trialEndsAt: string | null }
    | { status: 'checkpoint'; connectionId: string; checkpointType: string; sentTo: string | null; link: LinkupLinkCode | null }

function refusal(slug: AppSlug, err: unknown): AppActionError {
    if (err instanceof AppActionError) return err
    const app = appDefinition(slug)
    if (err instanceof LinkupError) {
        if (err.code === 'CHANNEL_ERROR' || err.code === 'INVALID_PARAMS') {
            const signIn = app.signInRefusal(err.message)
            return new AppActionError('refused', signIn.code, signIn.params)
        }
        console.error(`[apps:${slug}] Linkup refused`, err.code, err.message)
        return new AppActionError('unknown', 'appUnavailable', { provider: app.providerLabel })
    }
    console.error(`[apps:${slug}] connect failed`, err)
    return new AppActionError('unknown', 'connectionFailedRetry')
}

function assertCanConnect(state: SlotState, slug: AppSlug): void {
    const app = appDefinition(slug)
    if (!state.subscription || !isMachineEntitled(state.subscriptionStatus)) throw new AppActionError('not_entitled', 'appSubscribeToConnect', { provider: app.providerLabel })
    if (state.boxesArchived || state.app?.status === 'frozen') throw new AppActionError('paused', 'workspacePaused')
}

async function openConnection(supabase: Client, workspaceId: number, userId: string, slug: AppSlug): Promise<string> {
    const { data, error } = await supabase.from('app_connections').insert<ConnectionInsert>({ workspace_id: workspaceId, app_slug: slug, connected_by: userId, status: 'connecting' }).select('id').single()
    if (error || !data) throw new Error(error?.message ?? 'Could not open the connection')
    return data.id
}

// Each call is one attempt at somebody's LinkedIn password, or one account opened at Linkup: the
// form must not become a way to test a list of them.
async function claimLoginAttempt(supabase: Client, workspaceId: number, slug: AppSlug): Promise<void> {
    if (!(await claimQuota(supabase, workspaceScope(workspaceId), `login_attempt:${slug}`, [dayKey(new Date())], [DAILY_LOGIN_ATTEMPT_LIMIT]))) {
        throw new AppActionError('too_many_attempts', 'tooManySignInAttempts')
    }
}

// Opens or reopens the connection row, then signs in at Linkup with what `signIn` sends. Shared by
// every app: only what is sent to Linkup differs.
async function startConnection(slug: AppSlug, reconnectId: string | undefined, signIn: (accountName: string) => Promise<LinkupLoginResult>): Promise<ConnectOutcome> {
    const { workspace, userId, supabase } = await requireWorkspaceContext()
    const state = await readSlotState(supabase, workspace.id, slug)
    assertCanConnect(state, slug)

    const reconnecting = reconnectId ? state.holding.find(connection => connection.id === reconnectId) : undefined
    if (reconnectId && !reconnecting) throw new AuthorizationError('accountNotFound')
    // Only a signed-out account is reconnected in place. One paused for want of a paid slot gets its
    // slot back through Billing, never through a new sign-in.
    if (reconnecting && reconnecting.status !== 'needs_reconnect') throw new AppActionError('needs_slot', 'appAccountAwaitingSlot')
    if (!reconnecting && allowanceOf(state) === 'buy_slot') throw new AppActionError('needs_slot', 'appSlotsTaken', { provider: appDefinition(slug).providerLabel })
    await claimLoginAttempt(supabase, workspace.id, slug)

    const connectionId = reconnecting?.id ?? (await openConnection(supabase, workspace.id, userId, slug))
    if (reconnecting) await updateConnection(supabase, connectionId, { status: 'connecting', paused_until: null })

    let result: LinkupLoginResult
    try {
        result = await signIn(linkupAccountName(connectionId))
    } catch (err) {
        await updateConnection(supabase, connectionId, reconnecting ? { status: 'needs_reconnect', pause_reason: reconnecting.pause_reason } : { status: 'deleted' })
        throw refusal(slug, err)
    }
    return advance(supabase, slug, workspace.id, userId, connectionId, result, !!reconnecting)
}

export type LinkedinConnectInput = { connectionId?: string; country: string } & LinkedinCredentials

export async function connectLinkedin(input: LinkedinConnectInput): Promise<ConnectOutcome> {
    const credentials = 'loginToken' in input ? { loginToken: input.loginToken } : { email: input.email, password: input.password }
    return startConnection('linkedin', input.connectionId, accountName => loginLinkedin(credentials, { country: input.country, accountName }))
}

export type WhatsappConnectInput = { connectionId?: string; phoneNumber: string; pairingCode: boolean }

export async function connectWhatsapp(input: WhatsappConnectInput): Promise<ConnectOutcome> {
    return startConnection('whatsapp', input.connectionId, accountName => loginWhatsapp({ phoneNumber: input.phoneNumber, pairingCode: input.pairingCode }, accountName))
}

type ConnectingRow = { slug: AppSlug; providerAccountId: string; label: string | null }

async function connectingRow(supabase: Client, workspaceId: number, slug: AppSlug, connectionId: string): Promise<ConnectingRow> {
    const { data: connection } = await selectMaybeSingle(supabase, 'app_connections', ['provider_account_id', 'status', 'label'] as const, { id: connectionId, workspace_id: workspaceId, app_slug: slug })
    if (!connection?.provider_account_id || connection.status !== 'connecting') throw new AuthorizationError('accountNotFound')
    return { slug, providerAccountId: connection.provider_account_id, label: connection.label }
}

export async function submitAppCheckpoint(slug: AppSlug, connectionId: string, code?: string): Promise<ConnectOutcome> {
    const { workspace, userId, supabase } = await requireWorkspaceContext()
    const connection = await connectingRow(supabase, workspace.id, slug, connectionId)
    try {
        const result = await submitCheckpoint(connection.providerAccountId, code?.trim() || undefined)
        // Only an account that once finished connecting has a label: a reconnect goes back to
        // needs_reconnect on failure, a first connection is deleted.
        return advance(supabase, connection.slug, workspace.id, userId, connectionId, result, connection.label !== null)
    } catch (err) {
        throw refusal(connection.slug, err)
    }
}

// A new code sent by LinkedIn, or a new QR code for WhatsApp, which comes back in the answer.
export async function resendAppCode(slug: AppSlug, connectionId: string): Promise<LinkupLinkCode | null> {
    const { workspace, supabase } = await requireWorkspaceContext()
    const connection = await connectingRow(supabase, workspace.id, slug, connectionId)
    try {
        const result = await resendCheckpointCode(connection.providerAccountId)
        return result.status === 'checkpoint_required' ? result.link : null
    } catch (err) {
        throw refusal(connection.slug, err)
    }
}

// Abandoning the dialog halfway leaves an account at Linkup that nobody will finish connecting.
export async function cancelAppConnect(slug: AppSlug, connectionId: string): Promise<void> {
    const { workspace, supabase } = await requireWorkspaceContext()
    const { data: connection } = await selectMaybeSingle(supabase, 'app_connections', ['provider_account_id', 'status', 'label'] as const, { id: connectionId, workspace_id: workspace.id, app_slug: slug })
    if (!connection || connection.status !== 'connecting') return
    const reconnecting = connection.label !== null
    if (connection.provider_account_id && !reconnecting) await deleteAccount(connection.provider_account_id).catch(err => console.warn(`[apps:${slug}] could not delete an abandoned account`, err))
    await updateConnection(supabase, connectionId, { status: reconnecting ? 'needs_reconnect' : 'deleted' })
}

async function advance(supabase: Client, slug: AppSlug, workspaceId: number, userId: string, connectionId: string, result: LinkupLoginResult, reconnecting: boolean): Promise<ConnectOutcome> {
    const { data: previous } = await selectMaybeSingle(supabase, 'app_connections', ['provider_account_id', 'provider_webhook_id'] as const, { id: connectionId })
    const sameAccount = previous?.provider_account_id === result.accountId
    if (!sameAccount) {
        const { error } = await supabase.from('app_connections').update<Database['public']['Tables']['app_connections']['Update']>({ provider_account_id: result.accountId, provider_webhook_id: null, provider_webhook_secret: null }).eq('id', connectionId)
        if (error?.code === '23505') {
            await updateConnection(supabase, connectionId, { status: reconnecting ? 'needs_reconnect' : 'deleted' })
            throw new AppActionError('duplicate', 'appAccountAlreadyConnected', { provider: appDefinition(slug).providerLabel })
        }
        if (error) throw new Error(error.message)
        // A reconnect that came back as a new account leaves the old one billed at Linkup.
        if (reconnecting && previous?.provider_account_id) await deleteAccount(previous.provider_account_id).catch(err => console.warn(`[apps:${slug}] could not delete the replaced account`, err))
    }

    if (result.status === 'checkpoint_required') return { status: 'checkpoint', connectionId, checkpointType: result.checkpointType, sentTo: result.sentTo, link: result.link }

    try {
        return await finishConnection(supabase, slug, workspaceId, userId, connectionId, result.accountId, reconnecting, sameAccount && !!previous?.provider_webhook_id)
    } catch (err) {
        if (!reconnecting) await deleteAccount(result.accountId).catch(cleanup => console.warn(`[apps:${slug}] could not delete the account of a failed connection`, cleanup))
        await updateConnection(supabase, connectionId, { status: reconnecting ? 'needs_reconnect' : 'deleted' })
        throw refusal(slug, err)
    }
}

async function finishConnection(supabase: Client, slug: AppSlug, workspaceId: number, userId: string, connectionId: string, accountId: string, reconnecting: boolean, webhookKept: boolean): Promise<ConnectOutcome> {
    const app = appDefinition(slug)
    const { label, memberId } = await app.profile(accountId)

    const { data: twin } = await selectMany(supabase, 'app_connections', ['id'] as const, { workspace_id: workspaceId, app_slug: slug, provider_member_id: memberId, status: [...SLOT_HOLDING_STATUSES], id: { neq: connectionId } }, undefined, 1)
    if (twin?.length) throw new AppActionError('duplicate', 'appLabelAlreadyConnected', { label })

    const state = reconnecting ? null : await readSlotState(supabase, workspaceId, slug)
    const allowance: ConnectAllowance | 'reconnect' = state ? allowanceOf(state, connectionId) : 'reconnect'
    if (allowance === 'buy_slot') throw new AppActionError('needs_slot', 'appSlotsTaken', { provider: app.providerLabel })

    // What can still fail with Linkup goes first: past this point the trial is claimed and the slot
    // is on Stripe, and nothing left can throw but a write to our own database.
    if (!webhookKept) {
        const webhook = await createWebhook(accountId, webhookUrl(), app.webhookEvents)
        await updateConnection(supabase, connectionId, { provider_webhook_id: webhook.webhookId, provider_webhook_secret: webhook.secret })
    }

    let trialEndsAt: string | null = null
    if (state) {
        if (allowance === 'subscriber_trial') trialEndsAt = await claimSubscriberTrial(supabase, slug, workspaceId, memberId)
        if (allowance === 'workspace_trial_slot' && state.subscription) await addTrialSlot(state.subscription, app.addonKey, `trial-slot-${connectionId}`)
        await ensureWorkspaceApp(supabase, slug, workspaceId, trialEndsAt)
    }
    await updateConnection(supabase, connectionId, { status: 'connected', label, provider_member_id: memberId, connected_by: userId, pause_reason: null, paused_until: null })
    await reportWorkspaceEvent(supabase, workspaceId, 'app_connected', { app: slug, allowance, reconnect: reconnecting })
    if (trialEndsAt) await reportWorkspaceEvent(supabase, workspaceId, 'app_trial_started', { app: slug })
    return { status: 'connected', connectionId, label, trialEndsAt }
}

async function claimSubscriberTrial(supabase: Client, slug: AppSlug, workspaceId: number, memberId: string): Promise<string> {
    const { error } = await supabase.from('app_trial_claims').insert<TrialClaimInsert>({ app_slug: slug, workspace_id: workspaceId, provider_member_id: memberId })
    if (error?.code === '23505') throw new AppActionError('trial_used', 'appTrialUsed', { provider: appDefinition(slug).providerLabel })
    if (error) throw new Error(error.message)
    return new Date(Date.now() + TRIAL_DAYS * 86_400_000).toISOString()
}

async function ensureWorkspaceApp(supabase: Client, slug: AppSlug, workspaceId: number, trialEndsAt: string | null): Promise<void> {
    const { data: existing } = await selectMaybeSingle(supabase, 'workspace_apps', ['status'] as const, { workspace_id: workspaceId, app_slug: slug })
    const now = new Date().toISOString()
    if (!existing) {
        const { error } = await supabase.from('workspace_apps').insert<WorkspaceAppInsert>({ workspace_id: workspaceId, app_slug: slug, status: 'active', trial_ends_at: trialEndsAt })
        if (error) throw new Error(error.message)
        return
    }
    const { error } = await supabase
        .from('workspace_apps')
        .update<WorkspaceAppUpdate>({ status: 'active', updated_at: now, ...(trialEndsAt ? { trial_ends_at: trialEndsAt } : {}) })
        .eq('workspace_id', workspaceId)
        .eq('app_slug', slug)
    if (error) throw new Error(error.message)
}

// --- Disconnecting ---

// The account is deleted at Linkup straight away, so it stops costing. The slot stays on the bill
// until it is removed from Billing: a slot is what is sold, not an account.
export async function disconnectConnection(slug: AppSlug, connectionId: string): Promise<void> {
    const { workspace, supabase } = await requireWorkspaceContext()
    const { data: connection } = await selectMaybeSingle(supabase, 'app_connections', ['provider_account_id', 'status'] as const, { id: connectionId, workspace_id: workspace.id, app_slug: slug })
    if (!connection || connection.status === 'deleted') throw new AuthorizationError('accountNotFound')
    if (connection.provider_account_id) await deleteAccount(connection.provider_account_id)
    await removeBindingsOf(supabase, workspace.id, slug, [connectionId])
    await updateConnection(supabase, connectionId, { status: 'deleted', pause_reason: null, paused_until: null })
}

async function removeBindingsOf(supabase: Client, workspaceId: number, slug: AppSlug, connectionIds: string[]): Promise<void> {
    const { data: bindings } = await selectMany(supabase, 'app_connection_agents', ['agent_id'] as const, { connection_id: connectionIds })
    for (const binding of bindings ?? []) await dropWakeTrigger(supabase, workspaceId, binding.agent_id, slug)
    const { error } = await supabase.from('app_connection_agents').delete().in('connection_id', connectionIds)
    if (error) throw new Error(error.message)
}

// --- A coworker's account and its wake-ups ---

export type AgentAppBinding = { connectionId: string; label: string | null; status: string; wakeOnEvents: string[] } | null

export async function getAgentAppBinding(slug: AppSlug, agentId: string): Promise<AgentAppBinding> {
    await assertAgentInWorkspace(agentId)
    const { workspace, supabase } = await requireWorkspaceContext()
    const { data: binding } = await selectMaybeSingle(supabase, 'app_connection_agents', ['connection_id', 'wake_on_events'] as const, { agent_id: agentId, app_slug: slug })
    if (!binding) return null
    const { data: connection } = await selectMaybeSingle(supabase, 'app_connections', ['label', 'status', 'workspace_id'] as const, { id: binding.connection_id })
    if (!connection || connection.workspace_id !== workspace.id) return null
    return { connectionId: binding.connection_id, label: connection.label, status: connection.status, wakeOnEvents: binding.wake_on_events.filter(event => isWakeEventOf(slug, event)) }
}

export async function attachAgentToConnection(slug: AppSlug, agentId: string, connectionId: string): Promise<void> {
    await assertAgentInWorkspace(agentId, 'manage')
    const { workspace, supabase } = await requireWorkspaceContext()
    const { data: connection } = await selectMaybeSingle(supabase, 'app_connections', ['status'] as const, { id: connectionId, workspace_id: workspace.id, app_slug: slug })
    if (!connection || connection.status === 'deleted') throw new AuthorizationError('accountNotFound')

    const { data: existing } = await selectMaybeSingle(supabase, 'app_connection_agents', ['connection_id'] as const, { agent_id: agentId, app_slug: slug })
    if (existing?.connection_id === connectionId) return
    if (existing) {
        const { error } = await supabase.from('app_connection_agents').update<BindingUpdate>({ connection_id: connectionId, updated_at: new Date().toISOString() }).eq('agent_id', agentId).eq('app_slug', slug)
        if (error) throw new Error(error.message)
        return
    }
    const { error } = await supabase.from('app_connection_agents').insert<BindingInsert>({ agent_id: agentId, app_slug: slug, connection_id: connectionId })
    if (error) throw new Error(error.message)
}

// The hub creates the trigger on the engine, and only it knows its token: the webhook fires it as
// any caller of its public URL would. Turning every event off removes the trigger altogether.
export async function setAgentWakeEvents(slug: AppSlug, agentId: string, events: string[]): Promise<void> {
    const owned = await assertAgentInWorkspace(agentId, 'manage')
    const { workspace, supabase } = await requireWorkspaceContext()
    const app = appDefinition(slug)
    const wanted = [...new Set(events.filter(event => isWakeEventOf(slug, event)))]
    const { data: binding } = await selectMaybeSingle(supabase, 'app_connection_agents', ['trigger_slug'] as const, { agent_id: agentId, app_slug: slug })
    if (!binding) throw new AppActionError('unknown', 'appPickAccountFirst', { provider: app.providerLabel })

    if (wanted.length === 0) return dropWakeTrigger(supabase, workspace.id, agentId, slug)

    let trigger = binding.trigger_slug ? { slug: binding.trigger_slug } : null
    let token: string | null = null
    if (!trigger) {
        if (!owned.engine_agent_id) throw new AppActionError('unknown', 'coworkerNotRunning')
        const conn = await getWorkspaceConnection(workspace.id)
        const created = await engineCreateTrigger(conn, owned.engine_agent_id, { name: app.wakeTrigger.name, description: app.wakeTrigger.description, body: app.wakeTrigger.prompt(wanted), methods: ['POST'] })
        trigger = { slug: created.slug }
        token = created.token
    }

    const { error } = await supabase
        .from('app_connection_agents')
        .update<BindingUpdate>({ wake_on_events: wanted, trigger_slug: trigger.slug, ...(token ? { trigger_token: token } : {}), updated_at: new Date().toISOString() })
        .eq('agent_id', agentId)
        .eq('app_slug', slug)
    if (error) throw new Error(error.message)
}
