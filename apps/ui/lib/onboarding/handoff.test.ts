import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const dialog = vi.hoisted(() => ({ walks: true }))
vi.mock('@/lib/foreman/surface.server', () => ({ walksTheDialog: () => dialog.walks }))
vi.mock('@/lib/foreman/starter-pack-offer', () => ({ loadStarterPack: vi.fn(async () => ({ cards: [{ agent: 'Scout' }, { agent: 'Ledger' }] })) }))
const answers = vi.hoisted(() => ({ value: {} as Record<string, unknown> }))
vi.mock('@/lib/foreman/profile', () => ({ readAnswers: vi.fn(async () => answers.value) }))

import type { WorkspaceContext } from '@/app/api/_auth/ownership'
import { claimOnboardingHandoff, loadForemanHandoff } from './handoff'

const update = vi.fn()
const ctx = { workspace: { id: 7 }, supabase: { from: () => ({ update: (...args: unknown[]) => (update(...args), { eq: () => ({ filter: () => ({ select: async () => ({ data: answers.value.claimed ? [] : [{ workspace_id: 7 }], error: null }) }) }) }) }) } } as unknown as WorkspaceContext

function state(patch: Record<string, unknown> = {}) {
    return { foreman: { pendingInvites: [{ email: 'a@b.co', invitedBy: 'x' }] }, agents: [], isMember: false, ...patch } as never
}

beforeEach(() => {
    vi.clearAllMocks()
    dialog.walks = true
    answers.value = {}
})

describe('loadForemanHandoff', () => {
    it('names the cards and the invitations while there is no team', async () => {
        await expect(loadForemanHandoff(ctx, state(), 'hello')).resolves.toEqual({ buildable: true, arrival: null, prompt: null, pack: ['Scout', 'Ledger'], pendingInvites: 1, inviteLinks: [] })
    })

    it('carries what they typed on the landing', async () => {
        const handoff = await loadForemanHandoff(ctx, state({ foreman: { arrival: { kind: 'prompt', ref: 'Answer my leads', at: 'x' } } }), 'hello')
        expect(handoff?.prompt).toBe('Answer my leads')
    })

    it('opens on what a link installed, and only on the turn that opens the conversation', async () => {
        const installed = state({ foreman: { installedFirst: true, firstRunAt: 'x', plan: { title: 'Acme', items: [{ kind: 'template', slug: 'crm', title: 'CRM pipeline' }] } }, agents: [{ id: 'a1' }] })
        await expect(loadForemanHandoff(ctx, installed, '[[foreman:start]]')).resolves.toMatchObject({ buildable: false, arrival: { kind: 'template', title: 'CRM pipeline' }, pack: [] })
        await expect(loadForemanHandoff(ctx, installed, 'thanks')).resolves.toBeNull()
    })

    it('says nothing to a member, nor in a workspace from before the dialog', async () => {
        await expect(loadForemanHandoff(ctx, state({ isMember: true }), 'hello')).resolves.toBeNull()
        dialog.walks = false
        await expect(loadForemanHandoff(ctx, state(), 'hello')).resolves.toBeNull()
    })
})

describe('claimOnboardingHandoff', () => {
    it('lets the first admin open the conversation, and nobody after', async () => {
        await expect(claimOnboardingHandoff(ctx)).resolves.toBe(true)
        expect(update).toHaveBeenCalledWith(expect.objectContaining({ answers: { foreman: { handoffAt: expect.any(String) } } }))
        answers.value = { claimed: true }
        await expect(claimOnboardingHandoff(ctx)).resolves.toBe(false)
        answers.value = { foreman: { handoffAt: 'x' } }
        await expect(claimOnboardingHandoff(ctx)).resolves.toBe(false)
    })
})
