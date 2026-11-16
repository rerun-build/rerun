import { beforeEach, describe, expect, it, vi } from 'vitest'

const ctx = vi.hoisted(() => ({ value: {} as Record<string, unknown> }))
const answers = vi.hoisted(() => ({ value: {} as Record<string, unknown> }))
vi.mock('server-only', () => ({}))
vi.mock('@/app/api/_auth/ownership', () => ({ requireWorkspaceContext: vi.fn(async () => ctx.value) }))
vi.mock('@/lib/foreman/profile', () => ({ readAnswers: vi.fn(async () => answers.value), mergeForeman: vi.fn(async () => ({})) }))
const release = vi.hoisted(() => ({ at: '2026-12-01T00:00:00Z' as string | null }))
vi.mock('@/lib/onboarding/facts', () => ({ onboardingReleasedAt: () => release.at }))
const edition = vi.hoisted(() => ({ cloud: true, entitled: true }))
vi.mock('@rerun/cloud/edition', () => ({
    get RERUN_CLOUD() {
        return edition.cloud
    },
}))
vi.mock('@rerun/cloud/billing', () => ({ isSubscriptionEntitled: () => edition.entitled }))
vi.mock('@/app/api/_services/workspace-engine.service', () => ({ ensureWorkspaceEngine: vi.fn(async () => ({ ok: true, instanceId: 'box-1' })) }))
vi.mock('@/lib/onboarding/install-arrival', () => ({ installArrival: vi.fn(async () => ({ status: 'installed' })) }))

import { mergeForeman } from '@/lib/foreman/profile'
import { ensureWorkspaceEngine } from '@/app/api/_services/workspace-engine.service'
import { claimOnboardingEngineAction, recordOnboardingArrivalAction, saveOnboardingInvitesAction } from './onboarding-dialog.actions'

function ctxOf(patch: { role?: 'admin' | 'member'; onboarded_at?: string | null; created_at?: string } = {}) {
    return { userId: 'admin-1', userEmail: 'ada@acme.test', role: patch.role ?? 'admin', boxScope: 'all', workspace: { id: 7, is_sandbox: false, onboarded_at: patch.onboarded_at ?? null, created_at: patch.created_at ?? '2026-12-02T00:00:00Z' } }
}

beforeEach(() => {
    vi.clearAllMocks()
    ctx.value = ctxOf()
    answers.value = {}
    release.at = '2026-12-01T00:00:00Z'
    edition.cloud = true
    edition.entitled = true
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

describe('claimOnboardingEngineAction', () => {
    it('takes the box of a workspace on its plan', async () => {
        await expect(claimOnboardingEngineAction()).resolves.toEqual({ status: 'claimed' })
        expect(ensureWorkspaceEngine).toHaveBeenCalledWith(7)
    })

    it('waits out an empty pool on Rerun Cloud, and says so', async () => {
        vi.mocked(ensureWorkspaceEngine).mockResolvedValueOnce({ ok: false, error: 'No machine' })
        const error = vi.spyOn(console, 'error').mockImplementation(() => {})
        await expect(claimOnboardingEngineAction()).resolves.toEqual({ status: 'no_machine' })
        expect(error).toHaveBeenCalled()
        error.mockRestore()
    })

    it('sends a second self-hosted workspace to Servers', async () => {
        edition.cloud = false
        vi.mocked(ensureWorkspaceEngine).mockResolvedValueOnce({ ok: false, error: 'This workspace has no server yet.' })
        await expect(claimOnboardingEngineAction()).resolves.toEqual({ status: 'no_server' })
    })

    it('refuses a workspace without its plan and a member, claiming nothing', async () => {
        edition.entitled = false
        await expect(claimOnboardingEngineAction()).resolves.toEqual({ status: 'refused' })
        edition.entitled = true
        ctx.value = ctxOf({ role: 'member' })
        await expect(claimOnboardingEngineAction()).resolves.toEqual({ status: 'refused' })
        expect(ensureWorkspaceEngine).not.toHaveBeenCalled()
    })
})
