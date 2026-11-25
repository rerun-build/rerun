import { RERUN_BRAND } from '@rerun/contracts'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { MemoryRow } from '@/ee/test/memory-database'
import { ADMIN, AGENCY_HOME, CLIENT, CLIENT_ADMIN, memberRow, NORDLYS, organizationWorld, OWNER, RIVAL_WORKSPACE, workspaceRow } from '@/ee/test/organization-world'

const mocks = vi.hoisted(() => ({ client: null as unknown }))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: () => mocks.client }))

const { brandReachedBy, reachesBeyondOrganization } = await import('./organization-reach.service')

vi.useFakeTimers({ toFake: ['Date'] })

const OWN = 40
// The workspace an account has to have, as it is opened for an organization's team: nothing in it.
const untouched = (overrides: MemoryRow = {}) => workspaceRow(OWN, { organization_id: null, plan: 'base', subscription_status: null, ...overrides })
const open = (workspace: MemoryRow, agents: MemoryRow[] = []) => {
    const world = organizationWorld({ workspaces: [workspaceRow(CLIENT), workspaceRow(RIVAL_WORKSPACE, { organization_id: 'other' }), workspace], workspace_members: [memberRow(CLIENT_ADMIN, CLIENT), memberRow(CLIENT_ADMIN, OWN), memberRow(ADMIN, RIVAL_WORKSPACE), memberRow(ADMIN, CLIENT, { organization_staff: true })], agents })
    mocks.client = world.client
}

// Past what is kept in memory, so that each test reads its own rows.
beforeEach(() => vi.setSystemTime(Date.now() + 60_000))
afterAll(() => void vi.useRealTimers())

describe('an account that works beyond an organization', () => {
    it('is not one its workspaces are all it has', async () => {
        mocks.client = organizationWorld().client
        expect(await reachesBeyondOrganization(CLIENT_ADMIN, NORDLYS)).toBe(false)
    })

    it('is not one whose own workspace was opened for it and never used', async () => {
        open(untouched(), [{ id: 'a', workspace_id: OWN, kind: 'foreman' }])
        expect(await reachesBeyondOrganization(CLIENT_ADMIN, NORDLYS)).toBe(false)
    })

    it.each([
        ['a plan', untouched({ plan: 'pro' }), []],
        ['a subscription, even ended', untouched({ subscription_status: 'canceled' }), []],
        ['credit', untouched({ rerun_topup_micros: 10_000 }), []],
        ['a coworker', untouched(), [{ id: 'a', workspace_id: OWN, kind: 'coworker' }]],
    ])('is one whose own workspace holds %s', async (_what, workspace, agents) => {
        open(workspace, agents)
        expect(await reachesBeyondOrganization(CLIENT_ADMIN, NORDLYS)).toBe(true)
    })

    it('is one in a workspace of another organization, its team’s way in included', async () => {
        open(untouched())
        expect(await reachesBeyondOrganization(ADMIN, NORDLYS)).toBe(true)
        expect(await reachesBeyondOrganization(ADMIN, 'other')).toBe(true)
    })

    it('is the customer of Rerun who runs the organization', async () => {
        mocks.client = organizationWorld({ workspaces: [workspaceRow(AGENCY_HOME, { organization_id: null, plan: 'pro' }), workspaceRow(CLIENT)] }).client
        expect(await reachesBeyondOrganization(OWNER, NORDLYS)).toBe(true)
    })

    it('is asked once in a while, whoever asks', async () => {
        const world = organizationWorld()
        mocks.client = world.client
        await reachesBeyondOrganization(CLIENT_ADMIN, NORDLYS)
        const reads = world.calls.length
        await reachesBeyondOrganization(CLIENT_ADMIN, NORDLYS)
        expect(world.calls.length).toBe(reads)
    })
})

describe('where an account opens the app of an organization', () => {
    const brand = { ...RERUN_BRAND, organizationId: NORDLYS, name: 'Nordlys', appUrl: 'https://app.nordlys.no' }

    beforeEach(() => vi.stubEnv('ORGANIZATION_ROOT_DOMAIN', 'rerun.work'))
    afterEach(() => vi.unstubAllEnvs())

    it('is the address its brand names for someone who works for it alone', async () => {
        mocks.client = organizationWorld().client
        expect(await brandReachedBy(CLIENT_ADMIN, NORDLYS, brand)).toBe(brand)
    })

    it('is its default address, never a domain of its own, for someone who also works elsewhere', async () => {
        mocks.client = organizationWorld({ workspaces: [workspaceRow(AGENCY_HOME, { organization_id: null, plan: 'pro' }), workspaceRow(CLIENT)] }).client
        expect(await brandReachedBy(OWNER, NORDLYS, brand)).toEqual({ ...brand, appUrl: 'https://nordlys.rerun.work' })
    })
})
