import { beforeEach, describe, expect, it, vi } from 'vitest'

const ctx = vi.hoisted(() => ({ value: {} as Record<string, unknown> }))
const answers = vi.hoisted(() => ({ value: {} as Record<string, unknown> }))
vi.mock('server-only', () => ({}))
vi.mock('@/app/api/_auth/ownership', () => ({ requireWorkspaceContext: vi.fn(async () => ctx.value) }))
vi.mock('@/lib/foreman/profile', () => ({ readAnswers: vi.fn(async () => answers.value), mergeForeman: vi.fn(async () => ({})) }))
const release = vi.hoisted(() => ({ at: '2026-12-01T00:00:00Z' as string | null }))
vi.mock('@/lib/onboarding/facts', () => ({ onboardingReleasedAt: () => release.at }))

import { mergeForeman } from '@/lib/foreman/profile'
import { recordOnboardingArrivalAction, saveOnboardingInvitesAction } from './onboarding-dialog.actions'

function ctxOf(patch: { role?: 'admin' | 'member'; onboarded_at?: string | null; created_at?: string } = {}) {
    return { userId: 'admin-1', userEmail: 'ada@acme.test', role: patch.role ?? 'admin', boxScope: 'all', workspace: { id: 7, is_sandbox: false, onboarded_at: patch.onboarded_at ?? null, created_at: patch.created_at ?? '2026-12-02T00:00:00Z' } }
}

beforeEach(() => {
    vi.clearAllMocks()
    ctx.value = ctxOf()
    answers.value = {}
    release.at = '2026-12-01T00:00:00Z'
})

describe('saveOnboardingInvitesAction', () => {
    it('keeps each address once, lower case, without the admin own address', async () => {
        await expect(saveOnboardingInvitesAction([' Bob@Acme.test ', 'bob@acme.test', 'ada@acme.test', 'not an email', 'carol@acme.test'])).resolves.toEqual({ ok: true })
        expect(mergeForeman).toHaveBeenCalledWith(ctx.value, {
            pendingInvites: [
                { email: 'bob@acme.test', invitedBy: 'admin-1' },
                { email: 'carol@acme.test', invitedBy: 'admin-1' },
            ],
            inviteAt: expect.any(String),
        })
    })

    it('skips the step with an empty list', async () => {
        await saveOnboardingInvitesAction([])
        expect(mergeForeman).toHaveBeenCalledWith(ctx.value, { pendingInvites: [], inviteAt: expect.any(String) })
    })

    it('refuses more than ten addresses and a member', async () => {
        expect((await saveOnboardingInvitesAction(Array.from({ length: 11 }, (_, i) => `p${i}@acme.test`))).ok).toBe(false)
        ctx.value = ctxOf({ role: 'member' })
        expect((await saveOnboardingInvitesAction(['bob@acme.test'])).ok).toBe(false)
        expect(mergeForeman).not.toHaveBeenCalled()
    })
})

describe('recordOnboardingArrivalAction', () => {
    it('writes down the link a new workspace arrived on', async () => {
        await recordOnboardingArrivalAction('template', 'crm-pipeline')
        expect(mergeForeman).toHaveBeenCalledWith(ctx.value, { arrival: { kind: 'template', ref: 'crm-pipeline', at: expect.any(String) } })
    })

    it('leaves a workspace that answered, arrived already, runs, or is older than the release alone', async () => {
        answers.value = { foreman: { profileAt: 'x' } }
        await recordOnboardingArrivalAction('template', 'crm-pipeline')
        answers.value = { foreman: { arrival: { kind: 'share', ref: 'tok', at: 'x' } } }
        await recordOnboardingArrivalAction('template', 'crm-pipeline')
        answers.value = {}
        ctx.value = ctxOf({ onboarded_at: 'x' })
        await recordOnboardingArrivalAction('template', 'crm-pipeline')
        ctx.value = ctxOf({ created_at: '2026-11-20T00:00:00Z' })
        await recordOnboardingArrivalAction('template', 'crm-pipeline')
        ctx.value = ctxOf({ role: 'member' })
        await recordOnboardingArrivalAction('template', 'crm-pipeline')
        expect(mergeForeman).not.toHaveBeenCalled()
    })

    it('refuses a kind it does not know and an empty reference', async () => {
        await recordOnboardingArrivalAction('agent' as never, 'x')
        await recordOnboardingArrivalAction('share', '   ')
        expect(mergeForeman).not.toHaveBeenCalled()
    })
})
