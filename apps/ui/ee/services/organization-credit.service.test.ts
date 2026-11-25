import { MICROS_PER_CREDIT } from '@rerun/contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { SupabaseCall } from '@/test/supabase-fake'
import { writeMethodOf } from '@/test/supabase-fake'
import { CLIENT, HAVRE, NORDLYS, organizationContext, organizationTables, organizationWorld, RIVAL, RIVAL_WORKSPACE, workspaceRow, type OrganizationWorld } from '@/ee/test/organization-world'

const mocks = vi.hoisted(() => ({ client: null as unknown }))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: () => mocks.client }))
vi.mock('@/supabase/session/getServerSession', () => ({ getSessionIdentity: vi.fn() }))
vi.mock('@rerun/cloud/organizations', () => ({ ORGANIZATIONS_ENABLED: true }))
vi.mock('@/app/api/_services/remote-computers.service', () => ({ revokeMemberComputers: vi.fn() }))

const { adjustOrganizationCredit, allocateOrganizationCredit, loadOrganizationCredit, MAX_CREDITS_PER_MOVEMENT, purchaseOrganizationCredit, reserveBalanceMicros, returnCreditToReserve, takeBackOrganizationCredit } = await import('./organization-credit.service')

const request = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const credits = (n: number) => n * MICROS_PER_CREDIT

let world: OrganizationWorld

function open(before?: (table: string, calls: readonly SupabaseCall[]) => { error: unknown } | undefined | void, topup = 0): void {
    const tables = organizationTables()
    world = organizationWorld({ ...tables, workspaces: [...tables.workspaces.filter(row => row.id !== CLIENT), workspaceRow(CLIENT, { name: 'Acme', rerun_topup_micros: topup })] }, before)
    mocks.client = world.client
}

const ledger = () => world.rows('organization_credit_movements')
const topupOf = (id: number) => world.rows('workspaces').find(row => row.id === id)!.rerun_topup_micros as number
const balance = () => reserveBalanceMicros(world.client, NORDLYS)
const buy = (amount: number, n: number) => purchaseOrganizationCredit(world.client, { organizationId: NORDLYS, credits: amount, actorUserId: null, requestId: request(n) })
const allocate = (amount: number, n: number, ctx = organizationContext(world)) => allocateOrganizationCredit(ctx, { workspaceId: CLIENT, credits: amount, requestId: request(n) })
const takeBack = (amount: number, n: number) => takeBackOrganizationCredit(organizationContext(world), { workspaceId: CLIENT, credits: amount, requestId: request(n) })

// What is in the reserve and in the workspace only ever moves between the two.
function expectLedgerToAddUp() {
    let running = 0
    for (const [index, row] of ledger().entries()) {
        running += row.micros as number
        expect(row.seq).toBe(index + 1)
        expect(row.balance_after).toBe(running)
        expect(running).toBeGreaterThanOrEqual(0)
    }
}

beforeEach(() => open())

describe('the reserve', () => {
    it('is empty until something is bought, then holds what was', async () => {
        expect(await balance()).toBe(0)
        expect(await buy(500, 1)).toBe(credits(500))
        expect(await buy(200, 2)).toBe(credits(700))
        expect(await balance()).toBe(credits(700))
        expectLedgerToAddUp()
    })

    it('is each organization’s own', async () => {
        await buy(500, 1)
        expect(await reserveBalanceMicros(world.client, HAVRE)).toBe(0)
    })

    it('records a purchase reported twice once', async () => {
        await Promise.all([buy(500, 1), buy(500, 1)])
        expect(await balance()).toBe(credits(500))
        expect(ledger()).toHaveLength(1)
    })

    it('is corrected either way, never below zero', async () => {
        await buy(500, 1)
        await adjustOrganizationCredit(world.client, { organizationId: NORDLYS, credits: -200, note: 'Refund', actorUserId: null, requestId: request(2) })
        expect(await balance()).toBe(credits(300))
        await expect(adjustOrganizationCredit(world.client, { organizationId: NORDLYS, credits: -301, actorUserId: null, requestId: request(3) })).rejects.toMatchObject({ code: 'organizationCreditInsufficient' })
        expectLedgerToAddUp()
    })

    it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, MAX_CREDITS_PER_MOVEMENT + 1])('refuses a purchase, an allocation and a take back of %s', async amount => {
        await buy(500, 1)
        for (const attempt of [buy(amount, 2), allocate(amount, 3), takeBack(amount, 4)]) await expect(attempt).rejects.toMatchObject({ code: 'invalidRequest' })
        expect(ledger()).toHaveLength(1)
    })

    it('refuses an adjustment of nothing', async () => {
        await expect(adjustOrganizationCredit(world.client, { organizationId: NORDLYS, credits: 0, actorUserId: null, requestId: request(2) })).rejects.toMatchObject({ code: 'invalidRequest' })
    })
})

describe('an allocation', () => {
    it('leaves the reserve and reaches the workspace, with the name it had', async () => {
        await buy(500, 1)
        await allocate(120, 2)

        expect(await balance()).toBe(credits(380))
        expect(topupOf(CLIENT)).toBe(credits(120))
        expect(ledger()[1]).toMatchObject({ kind: 'allocation', micros: -credits(120), workspace_id: CLIENT, workspace_name: 'Acme', applied_at: expect.any(String) })
    })

    it('takes exactly what is left, and not one credit more', async () => {
        await buy(100, 1)
        await expect(allocate(101, 2)).rejects.toMatchObject({ code: 'organizationCreditInsufficient' })
        await allocate(100, 3)
        expect(await balance()).toBe(0)
        await expect(allocate(1, 4)).rejects.toMatchObject({ code: 'organizationCreditInsufficient' })
        expect(topupOf(CLIENT)).toBe(credits(100))
    })

    it('lands once on a double click', async () => {
        await buy(500, 1)
        await Promise.all([allocate(120, 2), allocate(120, 2), allocate(120, 2)])
        expect(topupOf(CLIENT)).toBe(credits(120))
        expect(await balance()).toBe(credits(380))
        await allocate(120, 2)
        expect(topupOf(CLIENT)).toBe(credits(120))
        expectLedgerToAddUp()
    })

    it('keeps two different ones written at once, each from the balance the other left', async () => {
        await buy(500, 1)
        await Promise.all([allocate(100, 2), allocate(50, 3), allocate(25, 4)])
        expect(topupOf(CLIENT)).toBe(credits(175))
        expect(await balance()).toBe(credits(325))
        expectLedgerToAddUp()
    })

    it('never hands the last credit out twice', async () => {
        await buy(100, 1)
        const results = await Promise.allSettled([allocate(100, 2), allocate(100, 3)])
        expect(results.map(result => result.status).sort()).toEqual(['fulfilled', 'rejected'])
        expect(topupOf(CLIENT)).toBe(credits(100))
        expect(await balance()).toBe(0)
        expectLedgerToAddUp()
    })

    it('goes back to the reserve when the workspace could not be credited', async () => {
        let down = true
        open(table => (down && table === 'rpc:grant_rerun_topup' ? { error: { message: 'down' } } : undefined))
        await buy(500, 1)
        await expect(allocate(120, 2)).rejects.toMatchObject({ code: 'organizationCreditFailed' })

        expect(await balance()).toBe(credits(500))
        expect(topupOf(CLIENT)).toBe(0)
        expect(ledger()[2]).toMatchObject({ kind: 'take_back', micros: credits(120), reversal_of: ledger()[1].id })

        // The same request again is told it failed, rather than taken for done.
        down = false
        await expect(allocate(120, 2)).rejects.toMatchObject({ code: 'organizationCreditFailed' })
        expect(topupOf(CLIENT)).toBe(0)
        await allocate(120, 3)
        expect(topupOf(CLIENT)).toBe(credits(120))
        expectLedgerToAddUp()
    })

    it('finishes on a retry when the first try died before granting it', async () => {
        await buy(500, 1)
        world.rows('organization_credit_movements').push({ id: 'dead', organization_id: NORDLYS, seq: 2, kind: 'allocation', micros: -credits(120), balance_after: credits(380), workspace_id: CLIENT, workspace_name: 'Acme', request_id: request(2), applied_at: null, reversal_of: null })
        await allocate(120, 2)
        expect(topupOf(CLIENT)).toBe(credits(120))
        expect(await balance()).toBe(credits(380))
    })

    it('gives up after five moves in a row under it, with nothing handed out', async () => {
        await buy(500, 1)
        open((table, calls) => (table === 'organization_credit_movements' && writeMethodOf(calls) === 'insert' ? { error: { code: '23505', message: 'taken' } } : undefined))
        world.rows('organization_credit_movements').push({ organization_id: NORDLYS, seq: 1, balance_after: credits(500), request_id: request(1) })
        await expect(allocate(1, 2)).rejects.toMatchObject({ code: 'organizationCreditBusy' })
        expect(topupOf(CLIENT)).toBe(0)
    })

    it('refuses a workspace of another organization, a request id of another one, and an archived workspace', async () => {
        await buy(500, 1)
        await expect(allocateOrganizationCredit(organizationContext(world), { workspaceId: RIVAL_WORKSPACE, credits: 10, requestId: request(2) })).rejects.toMatchObject({ code: 'workspaceNotFound' })

        const rival = organizationContext(world, { organizationId: HAVRE, userId: RIVAL })
        await expect(allocateOrganizationCredit(rival, { workspaceId: RIVAL_WORKSPACE, credits: 10, requestId: request(1) })).rejects.toMatchObject({ code: 'invalidRequest' })

        world.rows('workspaces').find(row => row.id === CLIENT)!.organization_archived_at = '2026-11-20T00:00:00Z'
        await expect(allocate(10, 4)).rejects.toMatchObject({ code: 'workspaceArchived' })
        expect(ledger()).toHaveLength(1)
    })
})

describe('taking credit back', () => {
    it('returns what is asked', async () => {
        open(undefined, credits(120))
        expect(await takeBack(50, 2)).toBe(credits(50))
        expect(topupOf(CLIENT)).toBe(credits(70))
        expect(await balance()).toBe(credits(50))
    })

    it('returns what is left of it when more is asked, to the last micro', async () => {
        open(undefined, 1_234_567)
        expect(await takeBack(500, 2)).toBe(1_234_567)
        expect(topupOf(CLIENT)).toBe(0)
        expect(await balance()).toBe(1_234_567)
    })

    it('refuses when nothing is left', async () => {
        await expect(takeBack(1, 2)).rejects.toMatchObject({ code: 'organizationNothingToTakeBack' })
        expect(ledger()).toHaveLength(0)
    })

    it('never takes what a coworker spent in between', async () => {
        let spent = false
        open((table, calls) => {
            if (spent || table !== 'workspaces' || writeMethodOf(calls) !== 'update') return
            spent = true
            const workspace = world.rows('workspaces').find(row => row.id === CLIENT)!
            workspace.rerun_topup_micros = (workspace.rerun_topup_micros as number) - credits(100)
        }, credits(120))
        expect(await takeBack(120, 2)).toBe(credits(20))
        expect(topupOf(CLIENT)).toBe(0)
        expect(await balance()).toBe(credits(20))
    })

    it('lands once on a double click, whatever the order the two meet in', async () => {
        open(undefined, credits(120))
        const results = await Promise.all([takeBack(50, 2), takeBack(50, 2)])
        expect(results).toEqual([credits(50), credits(50)])
        expect(topupOf(CLIENT)).toBe(credits(70))
        expect(await balance()).toBe(credits(50))
        expect(await takeBack(50, 2)).toBe(credits(50))
        expect(topupOf(CLIENT)).toBe(credits(70))
        expect(ledger()).toHaveLength(1)
    })

    it('gives it back to the workspace when the ledger could not be written', async () => {
        open((table, calls) => (table === 'organization_credit_movements' && writeMethodOf(calls) === 'insert' ? { error: { code: '08006', message: 'down' } } : undefined), credits(120))
        await expect(takeBack(50, 2)).rejects.toThrow('down')
        expect(topupOf(CLIENT)).toBe(credits(120))
    })

    it('crosses an allocation without losing a credit', async () => {
        open(undefined, credits(120))
        await buy(100, 1)
        await Promise.all([allocate(40, 2), takeBack(60, 3)])
        expect(topupOf(CLIENT) + (await balance())).toBe(credits(220))
        expectLedgerToAddUp()
    })

    it('returns everything before a workspace is deleted, and nothing from an empty one', async () => {
        open(undefined, 777)
        const ctx = organizationContext(world)
        const workspace = world.rows('workspaces').find(row => row.id === CLIENT)!
        await returnCreditToReserve(ctx, workspace as never)
        await returnCreditToReserve(ctx, workspace as never)
        expect(await balance()).toBe(777)
        expect(ledger()).toHaveLength(1)
    })
})

describe('the history', () => {
    it('reads the latest first, a page at a time, with who did what', async () => {
        for (let n = 1; n <= 60; n++) await buy(1, n)
        await allocate(10, 100)

        const first = await loadOrganizationCredit(organizationContext(world))
        expect(first.balanceMicros).toBe(credits(50))
        expect(first.movements).toHaveLength(50)
        expect(first.movements[0]).toMatchObject({ kind: 'allocation', workspaceName: 'Acme', actorName: 'owner', reversed: false })
        const second = await loadOrganizationCredit(organizationContext(world), first.nextBeforeSeq!)
        expect(second.movements.map(movement => movement.seq)).toEqual([11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1])
        expect(second.nextBeforeSeq).toBeNull()
    })

    it('shows the allocation that failed as undone', async () => {
        open(table => (table === 'rpc:grant_rerun_topup' ? { error: { message: 'down' } } : undefined))
        await buy(500, 1)
        await expect(allocate(120, 2)).rejects.toThrow()
        const { movements } = await loadOrganizationCredit(organizationContext(world))
        expect(movements.map(movement => [movement.kind, movement.reversed, movement.reversalOf !== null])).toEqual([
            ['take_back', false, true],
            ['allocation', true, false],
            ['purchase', false, false],
        ])
    })

    it('never shows another organization’s', async () => {
        await buy(500, 1)
        expect(await loadOrganizationCredit(organizationContext(world, { organizationId: HAVRE, userId: RIVAL }))).toEqual({ balanceMicros: 0, movements: [], nextBeforeSeq: null })
    })
})
