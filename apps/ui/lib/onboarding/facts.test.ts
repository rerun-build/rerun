import { beforeEach, describe, expect, it, vi } from 'vitest'

const edition = vi.hoisted(() => ({ cloud: true }))
vi.mock('server-only', () => ({}))
vi.mock('@rerun/cloud/edition', () => ({
    get RERUN_CLOUD() {
        return edition.cloud
    },
}))
vi.mock('@rerun/cloud/engines', () => ({ poolHasRoom: vi.fn(async () => false) }))
vi.mock('@rerun/cloud/phone.server', () => ({ isPhoneStepPending: vi.fn(async () => true) }))
vi.mock('@rerun/cloud/billing', () => ({ isSubscriptionEntitled: (status: string | null) => status === 'trialing' || status === 'active' }))
vi.mock('@/app/api/_services/workspace-engine.service', () => ({ findWorkspaceEngine: vi.fn(async () => null) }))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: () => ({}) }))
vi.mock('@/supabase/supabase-helpers', () => ({
    selectMaybeSingle: vi.fn(async (_client: unknown, table: string) =>
        table === 'workspace_onboarding' ? { data: { answers: { foreman: { profileAt: 'x', inviteAt: 'y' } } } } : { data: { boxes_archived_at: null } },
    ),
    selectCount: vi.fn(async () => ({ data: 0 })),
}))

import type { WorkspaceContext } from '@/app/api/_auth/ownership'
import { findWorkspaceEngine } from '@/app/api/_services/workspace-engine.service'
import { poolHasRoom } from '@rerun/cloud/engines'
import { loadOnboardingFacts } from './facts'

function ctxOf(patch: { role?: 'admin' | 'member'; subscription_status?: string | null } = {}): WorkspaceContext {
    return {
        userId: 'user-1',
        userEmail: null,
        authUser: { user_metadata: {} },
        role: patch.role ?? 'admin',
        boxScope: 'all',
        supabase: {},
        workspace: { id: 7, is_sandbox: false, created_at: '2026-12-02T00:00:00Z', onboarded_at: null, subscription_status: patch.subscription_status ?? null },
    } as unknown as WorkspaceContext
}

describe('loadOnboardingFacts', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        edition.cloud = true
    })

    it('reads what the step is derived from', async () => {
        expect(await loadOnboardingFacts(ctxOf())).toEqual({
            admin: true,
            sandbox: false,
            createdAt: '2026-12-02T00:00:00Z',
            archived: false,
            onboardedAt: null,
            foreman: { profileAt: 'x', inviteAt: 'y' },
            agentCount: 0,
            phonePending: true,
            entitled: false,
            hasEngine: false,
            poolHasRoom: false,
            cloud: true,
        })
    })

    it('says a member is not an admin', async () => {
        expect((await loadOnboardingFacts(ctxOf({ role: 'member' }))).admin).toBe(false)
    })

    it('asks the pool only when it can change the step', async () => {
        await loadOnboardingFacts(ctxOf({ subscription_status: 'trialing' }))
        vi.mocked(findWorkspaceEngine).mockResolvedValueOnce({ instanceId: 'box-1' } as never)
        await loadOnboardingFacts(ctxOf())
        edition.cloud = false
        await loadOnboardingFacts(ctxOf())
        expect(poolHasRoom).not.toHaveBeenCalled()
    })
})
