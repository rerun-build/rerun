import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createServiceRoleClient } from '@/supabase/serviceRole'
import { fakeSupabase, type FakeSupabase } from '@/test/supabase-fake'
import { activeAgentLimit, assertEngineEntitlement, freeAgentSlots, hasFreeAgentSlot, isPlanLimited, PLAN_LIMIT_REASON } from './capacity.service'
vi.mock('@moldwright/cloud/billing', async importOriginal => ({ ...(await importOriginal<object>()), ...(await import('@/test/cloud-fakes')).CLOUD_ENTITLEMENTS }))

vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: vi.fn() }))

let workspace: { max_agents: number | null; subscription_status: string | null } | null
let activeAgents: number
let db: FakeSupabase

beforeEach(() => {
    workspace = { max_agents: 5, subscription_status: 'active' }
    activeAgents = 0
    db = fakeSupabase(table => {
        if (table === 'workspaces') return { data: workspace }
        if (table === 'agents') return { count: activeAgents }
        return undefined
    })
    vi.mocked(createServiceRoleClient).mockReturnValue(db.client)
})

describe('isPlanLimited', () => {
    it('reads an agent switched off for want of a slot as plan limited', () => {
        expect(isPlanLimited(PLAN_LIMIT_REASON)).toBe(true)
        expect(isPlanLimited(null)).toBe(true)
    })

    it('does not read a template revocation as plan limited', () => {
        expect(isPlanLimited('template_revoked:tpl_1')).toBe(false)
    })
})

describe('activeAgentLimit', () => {
    it('answers the plan allowance of a paying workspace', async () => {
        await expect(activeAgentLimit(1)).resolves.toBe(5)
    })

    it('keeps the full allowance of a past_due workspace', async () => {
        workspace = { max_agents: 5, subscription_status: 'past_due' }
        await expect(activeAgentLimit(1)).resolves.toBe(5)
    })

    it('runs a trial on its column, raised by hand or not', async () => {
        workspace = { max_agents: 3, subscription_status: 'trialing' }
        await expect(activeAgentLimit(1)).resolves.toBe(3)
        workspace = { max_agents: 5, subscription_status: 'trialing' }
        await expect(activeAgentLimit(1)).resolves.toBe(5)
    })

    it('collapses to zero without a live subscription', async () => {
        workspace = { max_agents: 5, subscription_status: 'canceled' }
        await expect(activeAgentLimit(1)).resolves.toBe(0)
    })

    it('answers zero for a missing workspace', async () => {
        workspace = null
        await expect(activeAgentLimit(1)).resolves.toBe(0)
    })

    it('answers null for an unlimited workspace', async () => {
        workspace = { max_agents: null, subscription_status: 'active' }
        await expect(activeAgentLimit(1)).resolves.toBeNull()
    })
})

describe('freeAgentSlots', () => {
    it('answers Infinity for an unlimited workspace without counting', async () => {
        workspace = { max_agents: null, subscription_status: 'active' }
        await expect(freeAgentSlots(1)).resolves.toBe(Infinity)
        expect(db.chainsOn('agents')).toHaveLength(0)
    })

    it('answers zero without a plan without counting', async () => {
        workspace = { max_agents: 5, subscription_status: null }
        await expect(freeAgentSlots(1)).resolves.toBe(0)
        expect(db.chainsOn('agents')).toHaveLength(0)
    })

    it('subtracts the active agents from the limit', async () => {
        activeAgents = 2
        await expect(freeAgentSlots(1)).resolves.toBe(3)
        expect(db.chainsOn('agents')[0].map(call => [call.method, ...call.args])).toEqual([
            ['from', 'agents'],
            ['select', '*', { count: 'exact', head: true }],
            ['eq', 'workspace_id', 1],
            ['is', 'disabled_at', null],
        ])
    })

    it('never goes below zero when more agents run than the plan allows', async () => {
        activeAgents = 9
        await expect(freeAgentSlots(1)).resolves.toBe(0)
    })
})

describe('hasFreeAgentSlot', () => {
    it('answers true while a slot is left', async () => {
        activeAgents = 4
        await expect(hasFreeAgentSlot(1)).resolves.toBe(true)
    })

    it('answers false once every slot is taken', async () => {
        activeAgents = 5
        await expect(hasFreeAgentSlot(1)).resolves.toBe(false)
    })
})

describe('assertEngineEntitlement', () => {
    it.each([['active'], ['trialing'], ['past_due']])('lets a %s workspace through', async status => {
        workspace = { max_agents: 5, subscription_status: status }
        await expect(assertEngineEntitlement(1)).resolves.toBeUndefined()
    })

    it.each([['canceled'], [null]])('refuses a %s workspace', async status => {
        workspace = { max_agents: 5, subscription_status: status }
        await expect(assertEngineEntitlement(1)).rejects.toThrow('This workspace has no active plan.')
    })

    it('refuses a missing workspace', async () => {
        workspace = null
        await expect(assertEngineEntitlement(1)).rejects.toThrow('This workspace has no active plan.')
    })
})
