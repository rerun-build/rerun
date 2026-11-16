import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('next/server', () => ({ after: vi.fn() }))
vi.mock('@rerun/analytics/server', () => ({ captureServer: vi.fn(async () => {}) }))
const clock = vi.hoisted(() => ({ waitForever: false }))
vi.mock('@rerun/contracts', async importOriginal => ({ ...(await importOriginal<object>()), sleep: vi.fn(async () => {}) }))
vi.mock('@/lib/foreman/state', () => ({ loadForemanState: vi.fn() }))
vi.mock('@/lib/foreman/onboarding-tools', () => ({ writePlan: vi.fn(async () => ({})) }))
vi.mock('@/lib/foreman/phases', () => ({ pinnedPlanBoxes: () => ['Sales', 'Ops'] }))
vi.mock('@/lib/foreman/starter-pack-offer', () => ({ loadStarterPack: vi.fn(async () => ({ cards: [{ slug: 'crm', agent: 'Scout', title: 'CRM', promise: 'Every lead answered', line: '', image: null, connectors: [] }], boxes: [{ name: 'Sales' }], box: 'Sales' })) }))
vi.mock('@/lib/foreman/build-once', () => ({ buildTeamOnce: vi.fn() }))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: () => ({}) }))
vi.mock('@/supabase/supabase-helpers', () => ({ selectMany: vi.fn(async () => ({ data: [{ id: 'a1', name: 'Scout', disabled_at: null }] })) }))

import type { WorkspaceContext } from '@/app/api/_auth/ownership'
import { buildTeamOnce } from '@/lib/foreman/build-once'
import { writePlan } from '@/lib/foreman/onboarding-tools'
import { loadForemanState } from '@/lib/foreman/state'
import { after } from 'next/server'
import { setUpTeam } from './team'

const admin = { userId: 'admin-1', role: 'admin', boxScope: 'all', workspace: { id: 7 } } as unknown as WorkspaceContext
const member = { ...admin, role: 'member' } as unknown as WorkspaceContext
const BUILT = { agents: [{ agentId: 'a1', name: 'Scout', active: true, lead: true }], failed: [], boxes: [], lead: { agentId: 'a1', name: 'Scout' } }

function state(patch: Record<string, unknown> = {}) {
    return { foreman: {}, agents: [], answers: { company_name: 'Acme' }, workspaceName: 'Acme', ...patch } as never
}

beforeEach(() => {
    vi.clearAllMocks()
    clock.waitForever = false
    vi.mocked(loadForemanState).mockResolvedValue(state())
    vi.mocked(buildTeamOnce).mockResolvedValue(BUILT as never)
})

describe('setUpTeam', () => {
    it('writes the picks of the starter pack as the plan, then builds it', async () => {
        await expect(setUpTeam(admin, { picks: ['crm', 'not-offered'] })).resolves.toEqual({ status: 'built', team: [{ name: 'Scout', agentId: 'a1', active: true, lead: true }], failed: [] })
        expect(writePlan).toHaveBeenCalledWith(admin, expect.objectContaining({ title: 'Acme', items: [expect.objectContaining({ kind: 'template', slug: 'crm' })] }), ['template'])
        expect(buildTeamOnce).toHaveBeenCalledTimes(1)
    })

    it('writes the one coworker it designed, in the first Box', async () => {
        await setUpTeam(admin, { coworker: { name: 'Scout', role: 'Answers every lead within the hour', need: 'leads wait for days' } })
        expect(writePlan).toHaveBeenCalledWith(admin, expect.objectContaining({ items: [{ kind: 'agent', name: 'Scout', role: 'Answers every lead within the hour', need: 'leads wait for days', box: 'Sales' }] }), ['agent'], 'leads wait for days')
    })

    it('returns the team already there instead of building a second one', async () => {
        vi.mocked(loadForemanState).mockResolvedValue(state({ foreman: { firstRunAt: 'x' } }))
        await expect(setUpTeam(admin, { picks: ['crm'] })).resolves.toMatchObject({ status: 'built', team: [{ name: 'Scout' }] })
        expect(buildTeamOnce).not.toHaveBeenCalled()
    })

    it('refuses a member, picks mixed with a coworker, picks the pack never offered, and nothing at all', async () => {
        await expect(setUpTeam(member, { picks: ['crm'] })).rejects.toThrow('Only an admin')
        await expect(setUpTeam(admin, { picks: ['crm'], coworker: { name: 'A', role: 'B' } })).rejects.toThrow('not both')
        await expect(setUpTeam(admin, { picks: ['nope'] })).rejects.toThrow('None of those slugs')
        await expect(setUpTeam(admin, {})).rejects.toThrow('Pass the slugs')
        expect(buildTeamOnce).not.toHaveBeenCalled()
    })

    it('answers `building` past a minute, and lets the build go on', async () => {
        vi.mocked(buildTeamOnce).mockReturnValue(new Promise(() => {}))
        await expect(setUpTeam(admin, { picks: ['crm'] })).resolves.toMatchObject({ status: 'building' })
        expect(after).toHaveBeenCalledTimes(1)
    })
})
