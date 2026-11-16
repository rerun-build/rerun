import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const answers = vi.hoisted(() => ({ value: {} as Record<string, unknown> }))
vi.mock('@/lib/foreman/profile', () => ({ readAnswers: vi.fn(async () => answers.value), mergeForeman: vi.fn(async () => ({})) }))
vi.mock('@/lib/foreman/state', () => ({ loadForemanState: vi.fn() }))
vi.mock('@/lib/foreman/scripted', () => ({ readyMadePlanOf: vi.fn() }))
vi.mock('@/lib/foreman/onboarding-tools', () => ({ writePlan: vi.fn(async () => ({})) }))
vi.mock('@/lib/foreman/phases', () => ({ planKinds: () => ['template', 'share'] }))
vi.mock('@/lib/foreman/template-purchase', () => ({ owedTemplatePurchase: vi.fn(async () => null) }))
vi.mock('@/lib/foreman/build-once', () => ({ buildTeamOnce: vi.fn(async () => ({ agents: [{ agentId: 'a1' }], failed: [], boxes: [], lead: null })) }))

import type { WorkspaceContext } from '@/app/api/_auth/ownership'
import { buildTeamOnce } from '@/lib/foreman/build-once'
import { writePlan } from '@/lib/foreman/onboarding-tools'
import { mergeForeman } from '@/lib/foreman/profile'
import { readyMadePlanOf } from '@/lib/foreman/scripted'
import { loadForemanState } from '@/lib/foreman/state'
import { owedTemplatePurchase } from '@/lib/foreman/template-purchase'
import { installArrival } from './install-arrival'

const ctx = { workspace: { id: 7 } } as unknown as WorkspaceContext
const PLAN = { title: 'Acme', items: [{ kind: 'template', slug: 'crm-pipeline', title: 'CRM pipeline' }] }

function stateWith(foreman: Record<string, unknown>) {
    return { foreman, answers: {}, workspaceName: 'Acme', phase: 'build' } as never
}

beforeEach(() => {
    vi.clearAllMocks()
    answers.value = { foreman: { arrival: { kind: 'template', ref: 'crm-pipeline', at: 'x' } } }
    vi.mocked(loadForemanState).mockResolvedValueOnce(stateWith({})).mockResolvedValue(stateWith({ plan: PLAN, installedFirst: true }))
    vi.mocked(readyMadePlanOf).mockReturnValue({ shown: { items: PLAN.items, boxes: [] } })
})

describe('installArrival', () => {
    it('writes the link as the plan, installed first, then builds it once', async () => {
        await expect(installArrival(ctx)).resolves.toEqual({ status: 'installed' })
        expect(loadForemanState).toHaveBeenCalledWith(ctx, null, { kind: 'template', slug: 'crm-pipeline' })
        expect(writePlan).toHaveBeenCalledWith(ctx, expect.objectContaining({ title: 'Acme' }), ['template', 'share'], null, true)
        expect(buildTeamOnce).toHaveBeenCalledTimes(1)
    })

    it('asks to buy a paid template first, and builds nothing', async () => {
        vi.mocked(owedTemplatePurchase).mockResolvedValueOnce({ slug: 'crm-pipeline', title: 'CRM pipeline', pricing: {} as never })
        await expect(installArrival(ctx)).resolves.toEqual({ status: 'purchase', slug: 'crm-pipeline', title: 'CRM pipeline' })
        expect(buildTeamOnce).not.toHaveBeenCalled()
    })

    it('gives up a link that no longer resolves, so the questions are asked instead', async () => {
        vi.mocked(readyMadePlanOf).mockReturnValueOnce(null)
        await expect(installArrival(ctx)).resolves.toEqual({ status: 'unavailable' })
        expect(mergeForeman).toHaveBeenCalledWith(ctx, { arrival: undefined })
    })

    it('picks up a link the hub onboarding already wrote down as its plan', async () => {
        answers.value = { foreman: { installedFirst: true, plan: { title: 'Acme', items: [{ kind: 'share', token: 'tok' }] } } }
        vi.mocked(loadForemanState).mockReset().mockResolvedValue(stateWith({ plan: PLAN, installedFirst: true }))
        await expect(installArrival(ctx)).resolves.toEqual({ status: 'installed' })
        expect(loadForemanState).toHaveBeenCalledWith(ctx, null, { kind: 'share', token: 'tok' })
        expect(writePlan).not.toHaveBeenCalled()
    })

    it('says what failed when nothing could be installed', async () => {
        vi.mocked(buildTeamOnce).mockResolvedValueOnce({ agents: [], failed: [{ name: 'Scout', error: 'engine unreachable' }], boxes: [], lead: null } as never)
        await expect(installArrival(ctx)).resolves.toEqual({ status: 'failed', error: 'engine unreachable' })
    })
})
