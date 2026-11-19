import 'server-only'

import { captureServer, deterministicUuid } from '@moldwright/analytics/server'
import { RERUN_CONNECTION_ID } from '@moldwright/contracts'

import type { Database } from '@/app/api/database.types'
import { isSubscriptionEntitled } from '@moldwright/cloud/billing'
import { extendTrial, subscriptionHasCard } from '@moldwright/cloud/billing.server'
import { listConnections, listSchedules } from '@/lib/engine/client'
import { GETTING_STARTED_EVENT_STEP, type EngineConnection, type EngineCreatedEvent } from '@/lib/engine/types'
import { GETTING_STARTED_REWARD_DAYS, GETTING_STARTED_STEPS, isComplete, progressOf, type GettingStartedItem } from '@/lib/onboarding/getting-started'
import { PHONE_STATUS_COLUMNS, phoneStatusOf, type PhoneStatus } from '@moldwright/cloud/phone'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMany, selectMaybeSingle, selectSingle } from '@/supabase/supabase-helpers'
import { resolveWorkspaceOwner } from './workspace-owner.service'
import { findWorkspaceEngine } from './workspace-engine.service'

type GettingStartedInsert = Database['public']['Tables']['workspace_getting_started']['Insert']
type GettingStartedUpdate = Database['public']['Tables']['workspace_getting_started']['Update']
type ServiceRoleClient = ReturnType<typeof createServiceRoleClient>

const ENGINE_CHECK_TIMEOUT_MS = 4000

const STEP_IDS = new Set<string>(GETTING_STARTED_STEPS.map(step => step.id))

export async function readGettingStartedItems(supabase: ServiceRoleClient, workspaceId: number): Promise<Set<GettingStartedItem>> {
    const { data } = await selectMany(supabase, 'workspace_getting_started', ['item'] as const, { workspace_id: workspaceId })
    return new Set((data ?? []).map(row => row.item as GettingStartedItem))
}

export async function markGettingStarted(supabase: ServiceRoleClient, workspaceId: number, items: GettingStartedItem[]): Promise<void> {
    if (!items.length) return
    const rows = items.map(item => ({ workspace_id: workspaceId, item }))
    const { error } = await supabase.from('workspace_getting_started').upsert<GettingStartedInsert>(rows, { onConflict: 'workspace_id,item', ignoreDuplicates: true })
    if (error) throw new Error(error.message)
    await reportGettingStartedSteps(supabase, workspaceId)
}

export async function reportGettingStartedSteps(supabase: ServiceRoleClient, workspaceId: number): Promise<void> {
    try {
        const { data, error } = await supabase
            .from('workspace_getting_started')
            .update<GettingStartedUpdate>({ reported_at: new Date().toISOString() })
            .eq('workspace_id', workspaceId)
            .in('item', [...STEP_IDS])
            .is('reported_at', null)
            .select('item, done_at')
        if (error) throw new Error(error.message)
        if (!data?.length) return

        const owner = await resolveWorkspaceOwner(workspaceId)
        if (!owner) return
        for (const row of data) {
            await captureServer(owner.email, 'getting_started_step_completed', { step: row.item }, { uuid: deterministicUuid(`getting_started:${workspaceId}:${row.item}`), timestamp: new Date(row.done_at) })
        }
    } catch (err) {
        console.error('[getting started] step capture failed', err)
    }
}

export async function restoreGettingStarted(supabase: ServiceRoleClient, workspaceId: number): Promise<void> {
    const { error } = await supabase.from('workspace_getting_started').delete().eq('workspace_id', workspaceId).eq('item', 'dismissed')
    if (error) throw new Error(error.message)
}

async function readPhoneStatus(supabase: ServiceRoleClient, userId: string): Promise<PhoneStatus> {
    const { data } = await selectMaybeSingle(supabase, 'user_phones', PHONE_STATUS_COLUMNS, { user_id: userId })
    return phoneStatusOf(data)
}

export async function recordGettingStartedEvent(workspaceId: number, event: EngineCreatedEvent['event']): Promise<void> {
    const step = GETTING_STARTED_EVENT_STEP[event]
    if (step) await markGettingStarted(createServiceRoleClient(), workspaceId, [step])
}

export async function markPaymentMethodAdded(workspaceId: number): Promise<void> {
    try {
        await markGettingStarted(createServiceRoleClient(), workspaceId, ['payment_method'])
    } catch (err) {
        console.error('[getting started] payment method step failed', err)
    }
}

async function hasOwnProvider(conn: EngineConnection): Promise<boolean> {
    const { connections } = await listConnections(conn, { signal: AbortSignal.timeout(ENGINE_CHECK_TIMEOUT_MS) })
    return connections.some(connection => connection.id !== RERUN_CONNECTION_ID && connection.connected)
}

async function hasSchedule(supabase: ServiceRoleClient, conn: EngineConnection, workspaceId: number): Promise<boolean> {
    const { data: agents } = await selectMany(supabase, 'agents', ['engine_agent_id'] as const, { workspace_id: workspaceId, engine_agent_id: { notNull: true } })
    const engineAgentIds = (agents ?? []).flatMap(agent => (agent.engine_agent_id ? [agent.engine_agent_id] : []))
    const lists = await Promise.all(engineAgentIds.map(id => listSchedules(conn, id, { signal: AbortSignal.timeout(ENGINE_CHECK_TIMEOUT_MS) }).catch(() => [])))
    return lists.some(list => list.length > 0)
}

export async function catchUpEngineSteps(supabase: ServiceRoleClient, workspaceId: number, items: ReadonlySet<GettingStartedItem>): Promise<GettingStartedItem[]> {
    const wantsProvider = !items.has('ai_provider')
    const wantsSchedule = !items.has('schedule')
    if (!wantsProvider && !wantsSchedule) return []

    const engine = await findWorkspaceEngine(workspaceId)
    if (!engine) return []

    const [provider, schedule] = await Promise.all([wantsProvider ? hasOwnProvider(engine.conn).catch(() => false) : false, wantsSchedule ? hasSchedule(supabase, engine.conn, workspaceId).catch(() => false) : false])
    const found: GettingStartedItem[] = []
    if (provider) found.push('ai_provider')
    if (schedule) found.push('schedule')
    return found
}

export async function catchUpPaymentMethod(supabase: ServiceRoleClient, workspaceId: number, items: ReadonlySet<GettingStartedItem>): Promise<GettingStartedItem[]> {
    if (items.has('payment_method')) return []

    const { data: workspace } = await selectSingle(supabase, 'workspaces', ['subscription_status', 'stripe_subscription_id'] as const, { id: workspaceId })
    if (!workspace || !isSubscriptionEntitled(workspace.subscription_status)) return []
    if (workspace.subscription_status !== 'trialing') return ['payment_method']
    if (!workspace.stripe_subscription_id) return []

    try {
        return (await subscriptionHasCard(workspace.stripe_subscription_id, ENGINE_CHECK_TIMEOUT_MS)) ? ['payment_method'] : []
    } catch {
        return []
    }
}

export async function grantGettingStartedReward(supabase: ServiceRoleClient, workspaceId: number, items: ReadonlySet<GettingStartedItem>): Promise<void> {
    if (items.has('reward') || !isComplete(progressOf(items, null))) return

    const owner = await resolveWorkspaceOwner(workspaceId)
    if (!isComplete(progressOf(items, owner ? await readPhoneStatus(supabase, owner.userId) : 'none'))) return

    const { data: workspace } = await selectSingle(supabase, 'workspaces', ['subscription_status', 'stripe_subscription_id'] as const, { id: workspaceId })
    if (workspace?.subscription_status !== 'trialing' || !workspace.stripe_subscription_id) return

    const { error: claimError } = await supabase.from('workspace_getting_started').insert<GettingStartedInsert>({ workspace_id: workspaceId, item: 'reward' })
    if (claimError) return

    const release = () => supabase.from('workspace_getting_started').delete().eq('workspace_id', workspaceId).eq('item', 'reward')
    try {
        const extended = await extendTrial(workspace.stripe_subscription_id, GETTING_STARTED_REWARD_DAYS, `getting-started-reward-ws-${workspaceId}`)
        if (!extended) {
            await release()
            return
        }
    } catch (err) {
        console.error('[getting started] trial extension failed', err)
        await release()
        return
    }

    try {
        if (owner) await captureServer(owner.email, 'trial_extended', { days: GETTING_STARTED_REWARD_DAYS, source: 'getting_started' }, { uuid: deterministicUuid(`trial_extended:getting_started:${workspaceId}`) })
    } catch (err) {
        console.error('[getting started] reward capture failed', err)
    }
}
