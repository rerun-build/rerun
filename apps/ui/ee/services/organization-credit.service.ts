import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/app/api/database.types'
import { resolveMemberIdentities } from '@/app/api/_services/members.service'
import { clearOrganizationCreditAlert } from '@/ee/services/organization-credit-alert.service'
import { requireOrganizationWorkspace, type OrganizationContext, type OrganizationWorkspaceRow } from '@/ee/services/organization-context.service'
import { grantRerunTopup } from '@/ee/services/rerunBudget.service'
import { AppError } from '@/lib/i18n/action-error'
import { randomUuid } from '@/lib/random-uuid'
import { selectAll, selectMany, selectMaybeSingle } from '@/supabase/supabase-helpers'
import { MICROS_PER_CREDIT } from '@rerun/contracts'

type Client = SupabaseClient<Database>
type MovementInsert = Database['public']['Tables']['organization_credit_movements']['Insert']
type MovementUpdate = Database['public']['Tables']['organization_credit_movements']['Update']
type WorkspaceUpdate = Database['public']['Tables']['workspaces']['Update']

export type CreditMovementKind = 'purchase' | 'adjustment' | 'allocation' | 'take_back'

const MOVEMENT_COLUMNS = ['id', 'organization_id', 'seq', 'kind', 'micros', 'balance_after', 'workspace_id', 'workspace_name', 'actor_user_id', 'note', 'request_id', 'applied_at', 'reversal_of', 'created_at'] as const

type MovementRow = Pick<Database['public']['Tables']['organization_credit_movements']['Row'], (typeof MOVEMENT_COLUMNS)[number]>

const UNIQUE_VIOLATION = '23505'
const MAX_ATTEMPTS = 5

// One movement, far above what is ever sold at once and far under what a bigint column read by
// JavaScript still counts exactly.
export const MAX_CREDITS_PER_MOVEMENT = 10_000_000

function microsOf(credits: number): number {
    if (!Number.isInteger(credits) || credits < 1 || credits > MAX_CREDITS_PER_MOVEMENT) throw new AppError('invalidRequest')
    return credits * MICROS_PER_CREDIT
}

async function lastMovement(supabase: Client, organizationId: string): Promise<{ seq: number; balance_after: number } | null> {
    const { data, error } = await selectMany(supabase, 'organization_credit_movements', ['seq', 'balance_after'] as const, { organization_id: organizationId }, { column: 'seq', ascending: false }, 1)
    if (error) throw new Error(error.message)
    return data?.[0] ?? null
}

export async function reserveBalanceMicros(supabase: Client, organizationId: string): Promise<number> {
    return (await lastMovement(supabase, organizationId))?.balance_after ?? 0
}

async function movementOfRequest(supabase: Client, requestId: string): Promise<MovementRow | null> {
    const { data, error } = await selectMaybeSingle(supabase, 'organization_credit_movements', MOVEMENT_COLUMNS, { request_id: requestId })
    if (error) throw new Error(error.message)
    return data
}

type NewMovement = {
    organizationId: string
    kind: CreditMovementKind
    micros: number
    workspace?: Pick<OrganizationWorkspaceRow, 'id' | 'name'>
    actorUserId: string | null
    note?: string | null
    requestId: string
    appliedAt?: string
    reversalOf?: string
}

// A request id is drawn for one intent: sent again for anything else, it is refused rather than
// answered with a movement the caller did not ask for.
function assertSameIntent(existing: MovementRow, wanted: NewMovement): void {
    const sameAmount = wanted.kind === 'take_back' || existing.micros === wanted.micros
    const same = sameAmount && existing.organization_id === wanted.organizationId && existing.kind === wanted.kind && existing.workspace_id === (wanted.workspace?.id ?? null)
    if (!same) throw new AppError('invalidRequest')
}

// One insert writes the movement and the balance it leaves. Numbered from the last one read: of two
// written at once, the second meets the number already taken and starts over from the new balance.
async function appendMovement(supabase: Client, wanted: NewMovement): Promise<{ movement: MovementRow; replayed: boolean }> {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const existing = await movementOfRequest(supabase, wanted.requestId)
        if (existing) {
            assertSameIntent(existing, wanted)
            return { movement: existing, replayed: true }
        }

        const last = await lastMovement(supabase, wanted.organizationId)
        const balance = (last?.balance_after ?? 0) + wanted.micros
        if (balance < 0) throw new AppError('organizationCreditInsufficient')
        if (!Number.isSafeInteger(balance)) throw new AppError('invalidRequest')

        const { data, error } = await supabase
            .from('organization_credit_movements')
            .insert<MovementInsert>({
                organization_id: wanted.organizationId,
                seq: (last?.seq ?? 0) + 1,
                kind: wanted.kind,
                micros: wanted.micros,
                balance_after: balance,
                workspace_id: wanted.workspace?.id ?? null,
                workspace_name: wanted.workspace?.name ?? null,
                actor_user_id: wanted.actorUserId,
                note: wanted.note ?? null,
                request_id: wanted.requestId,
                applied_at: wanted.appliedAt ?? null,
                reversal_of: wanted.reversalOf ?? null,
            })
            .select(MOVEMENT_COLUMNS.join(','))
            .single()
        if (data) return { movement: data as unknown as MovementRow, replayed: false }
        if (error?.code !== UNIQUE_VIOLATION) throw new Error(error?.message ?? 'The movement was not written')
    }
    throw new AppError('organizationCreditBusy')
}

type ReserveChange = { organizationId: string; credits: number; note?: string | null; actorUserId: string | null; requestId: string }

// What the organization paid Rerun for.
export async function purchaseOrganizationCredit(supabase: Client, { organizationId, credits, ...rest }: ReserveChange): Promise<number> {
    const { movement } = await appendMovement(supabase, { organizationId, kind: 'purchase', micros: microsOf(credits), appliedAt: new Date().toISOString(), ...rest })
    return movement.balance_after
}

// A correction by Rerun, either way.
export async function adjustOrganizationCredit(supabase: Client, { organizationId, credits, ...rest }: ReserveChange): Promise<number> {
    const micros = microsOf(Math.abs(credits)) * Math.sign(credits)
    const { movement } = await appendMovement(supabase, { organizationId, kind: 'adjustment', micros, appliedAt: new Date().toISOString(), ...rest })
    return movement.balance_after
}

type WorkspaceChange = { workspaceId: number; credits: number; requestId: string }

// Out of the reserve first, so that credit is never handed out twice, then into the workspace. The
// claim on `applied_at` is what lets one caller grant it: a request sent again finishes a grant that
// never happened, and never repeats one that did.
export async function allocateOrganizationCredit(ctx: OrganizationContext, { workspaceId, credits, requestId }: WorkspaceChange): Promise<void> {
    const { supabase, organization, userId } = ctx
    const workspace = await requireOrganizationWorkspace(ctx, workspaceId)
    if (workspace.organization_archived_at) throw new AppError('workspaceArchived')
    const { movement } = await appendMovement(supabase, { organizationId: organization.id, kind: 'allocation', micros: -microsOf(credits), workspace, actorUserId: userId, requestId })

    const { data: claimed, error } = await supabase
        .from('organization_credit_movements')
        .update<MovementUpdate>({ applied_at: new Date().toISOString() })
        .eq('id', movement.id)
        .is('applied_at', null)
        .select('id')
    if (error) throw new Error(error.message)
    if (!claimed?.length) {
        if (await isReversed(supabase, movement.id)) throw new AppError('organizationCreditFailed')
        return
    }

    if (await grantRerunTopup(workspaceId, -movement.micros)) {
        // The credit is in: a mark left behind only keeps the next alert from leaving.
        await clearOrganizationCreditAlert(supabase, workspaceId).catch(err => console.error('[organizations] failed to clear the credit alert', workspaceId, err))
        return
    }
    await appendMovement(supabase, { organizationId: organization.id, kind: 'take_back', micros: -movement.micros, workspace, actorUserId: userId, requestId: randomUuid(), appliedAt: new Date().toISOString(), reversalOf: movement.id }).catch(err =>
        console.error('[organizations] an allocation left the reserve, reached no workspace and could not be undone', { organizationId: organization.id, workspaceId, micros: -movement.micros, movementId: movement.id, err }),
    )
    throw new AppError('organizationCreditFailed')
}

async function isReversed(supabase: Client, movementId: string): Promise<boolean> {
    const { data, error } = await selectMaybeSingle(supabase, 'organization_credit_movements', ['id'] as const, { reversal_of: movementId })
    if (error) throw new Error(error.message)
    return data !== null
}

// What the workspace has not spent yet, up to the amount asked. Answers what really came back: its
// coworkers may be spending it at the same time.
export async function takeBackOrganizationCredit(ctx: OrganizationContext, { workspaceId, credits, requestId }: WorkspaceChange): Promise<number> {
    const workspace = await requireOrganizationWorkspace(ctx, workspaceId)
    const asked = microsOf(credits)
    const movement: NewMovement = { organizationId: ctx.organization.id, kind: 'take_back', micros: asked, workspace, actorUserId: ctx.userId, requestId, appliedAt: new Date().toISOString() }
    const done = await movementOfRequest(ctx.supabase, requestId)
    if (done) {
        assertSameIntent(done, movement)
        return done.micros
    }

    const taken = await takeFromWorkspace(ctx.supabase, workspaceId, Math.min(asked, await allocatedMicros(ctx, workspaceId)))
    if (taken === 0) throw new AppError('organizationNothingToTakeBack')
    return returnTaken(ctx.supabase, workspaceId, { ...movement, micros: taken })
}

// Before a workspace leaves the organization, deleted or detached: what the organization handed it and
// its client did not spend. Never more: a workspace that joined with credit of its own bought it from
// Rerun, and that is not the organization's to take.
export async function returnAllocatedCredit(ctx: OrganizationContext, workspace: OrganizationWorkspaceRow): Promise<void> {
    const taken = await takeFromWorkspace(ctx.supabase, workspace.id, await allocatedMicros(ctx, workspace.id))
    if (taken === 0) return
    await returnTaken(ctx.supabase, workspace.id, { organizationId: ctx.organization.id, kind: 'take_back', micros: taken, workspace, actorUserId: ctx.userId, requestId: randomUuid(), appliedAt: new Date().toISOString() })
}

// What the organization handed to a workspace and did not take back.
async function allocatedMicros({ supabase, organization }: OrganizationContext, workspaceId: number): Promise<number> {
    const { data, error } = await selectAll(supabase, 'organization_credit_movements', ['micros'] as const, { organization_id: organization.id, workspace_id: workspaceId })
    if (error) throw new Error(error.message)
    return Math.max(0, -data.reduce((sum, { micros }) => sum + micros, 0))
}

// Written only over the balance it was computed from: a run that spends meanwhile makes it start over.
async function takeFromWorkspace(supabase: Client, workspaceId: number, wanted: number): Promise<number> {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const { data: workspace, error } = await selectMaybeSingle(supabase, 'workspaces', ['rerun_topup_micros'] as const, { id: workspaceId })
        if (error) throw new Error(error.message)
        const held = workspace?.rerun_topup_micros ?? 0
        const taken = Math.min(held, wanted)
        if (taken <= 0) return 0

        const { data: written, error: writeError } = await supabase
            .from('workspaces')
            .update<WorkspaceUpdate>({ rerun_topup_micros: held - taken })
            .eq('id', workspaceId)
            .eq('rerun_topup_micros', held)
            .select('id')
        if (writeError) throw new Error(writeError.message)
        if (written?.length) return taken
    }
    throw new AppError('organizationCreditBusy')
}

// Anything that keeps it from the reserve gives it back to the workspace: a failed write, or the same
// request already answered by its double.
async function returnTaken(supabase: Client, workspaceId: number, movement: NewMovement): Promise<number> {
    let appended
    try {
        appended = await appendMovement(supabase, movement)
    } catch (err) {
        await giveBack(workspaceId, movement)
        throw err
    }
    if (appended.replayed) await giveBack(workspaceId, movement)
    return appended.movement.micros
}

// The credit left the workspace and reached nothing: said with what it takes to put it back by hand.
async function giveBack(workspaceId: number, { organizationId, micros, requestId }: NewMovement): Promise<void> {
    if (await grantRerunTopup(workspaceId, micros)) return
    console.error('[organizations] credit taken from a workspace reached neither the reserve nor the workspace again', { organizationId, workspaceId, micros, requestId })
}

export type CreditMovement = {
    id: string
    seq: number
    kind: CreditMovementKind
    micros: number
    balanceAfter: number
    workspaceId: number | null
    workspaceName: string | null
    actorName: string | null
    note: string | null
    // An allocation that never reached its workspace, and the movement that undid it.
    reversed: boolean
    reversalOf: string | null
    createdAt: string
}

const HISTORY_PAGE = 50

export type OrganizationCredit = { balanceMicros: number; movements: CreditMovement[]; nextBeforeSeq: number | null }

// Newest first, a page at a time: `beforeSeq` is the last number of the page before.
export async function loadOrganizationCredit(ctx: OrganizationContext, beforeSeq?: number): Promise<OrganizationCredit> {
    const { supabase, organization } = ctx
    const [balanceMicros, { data, error }] = await Promise.all([
        reserveBalanceMicros(supabase, organization.id),
        selectMany(supabase, 'organization_credit_movements', MOVEMENT_COLUMNS, { organization_id: organization.id, ...(beforeSeq ? { seq: { lt: beforeSeq } } : {}) }, { column: 'seq', ascending: false }, HISTORY_PAGE + 1),
    ])
    if (error) throw new Error(error.message)
    const rows = (data ?? []).slice(0, HISTORY_PAGE)

    // Rerun's own people sell and correct the reserve: the history names the team and nobody else.
    const { data: team, error: teamError } = await selectAll(supabase, 'organization_members', ['user_id'] as const, { organization_id: organization.id })
    if (teamError) throw new Error(teamError.message)
    const onTeam = new Set(team.map(member => member.user_id))
    const actorIds = [...new Set(rows.flatMap(row => (row.actor_user_id && onTeam.has(row.actor_user_id) ? row.actor_user_id : [])))]
    const [identities, { data: reversals }] = await Promise.all([resolveMemberIdentities(supabase, actorIds), selectMany(supabase, 'organization_credit_movements', ['reversal_of'] as const, { reversal_of: rows.map(row => row.id) })])
    const reversed = new Set((reversals ?? []).map(row => row.reversal_of))

    return {
        balanceMicros,
        movements: rows.map(row => {
            const actor = row.actor_user_id ? identities.get(row.actor_user_id) : undefined
            return {
                id: row.id,
                seq: row.seq,
                kind: row.kind as CreditMovementKind,
                micros: row.micros,
                balanceAfter: row.balance_after,
                workspaceId: row.workspace_id,
                workspaceName: row.workspace_name,
                actorName: actor?.name ?? actor?.email ?? null,
                note: row.note,
                reversed: reversed.has(row.id),
                reversalOf: row.reversal_of,
                createdAt: row.created_at,
            }
        }),
        nextBeforeSeq: (data ?? []).length > HISTORY_PAGE ? (rows.at(-1)?.seq ?? null) : null,
    }
}
