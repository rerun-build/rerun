import { beforeEach, describe, expect, it, vi } from 'vitest'

import { adminsToAlert, sendAlert } from '@/app/api/_services/admin-alert.service'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { fakeSupabase, tableResolver, writeMethodOf, type FakeSupabase } from '@/test/supabase-fake'
import { getWorkspaceBudget } from './rerunBudget.service'
import { notifyBudgetExhausted } from './budgetNotification.service'

vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: vi.fn() }))
vi.mock('@/app/api/_services/admin-alert.service', () => ({ adminsToAlert: vi.fn(), sendAlert: vi.fn() }))
vi.mock('@/app/api/_services/email.service', () => ({ sendBudgetExhaustedEmail: vi.fn() }))
vi.mock('@/lib/email/board-banner', () => ({ BANNER_WARM_BACKGROUND_MS: 0, alertBanner: vi.fn(async () => undefined) }))
vi.mock('@rerun/cloud/billing', async importOriginal => ({ ...(await importOriginal<object>()), isSubscriptionEntitled: (status: string) => status === 'active' }))
vi.mock('./rerunBudget.service', async importOriginal => ({ ...(await importOriginal<object>()), getWorkspaceBudget: vi.fn() }))

const BUDGET = { workspaceId: 7, budgetMicros: 20_000_000, usedMicros: 20_000_000, topupMicros: 0, periodAnchor: '2026-11-01T00:00:00.000Z', currentPeriodEnd: null, paused: false }
let usage: number
let tables: Record<string, object[]>
let db: FakeSupabase

beforeEach(() => {
    vi.clearAllMocks()
    usage = 3
    tables = { workspaces: [{ id: 7, name: 'Acme', is_sandbox: false, subscription_status: 'active' }], workspace_members: [{ workspace_id: 7, user_id: 'ada' }], notifications: [] }
    const read = tableResolver(new Proxy({}, { get: (_, table: string) => tables[table] ?? [] }))
    db = fakeSupabase((table, calls) => (table === 'rerun_usage_events' && !writeMethodOf(calls) ? { count: usage } : read(table, calls)))
    vi.mocked(createServiceRoleClient).mockReturnValue(db.client)
    vi.mocked(getWorkspaceBudget).mockResolvedValue(BUDGET)
    vi.mocked(adminsToAlert).mockResolvedValue(['ada'])
})

const alertedKey = () => vi.mocked(sendAlert).mock.calls[0]?.[1].key

describe('notifyBudgetExhausted', () => {
    it('writes the notice and emails the admins, once per month of credit', async () => {
        await notifyBudgetExhausted(7)

        expect(db.writes('notifications')).toHaveLength(1)
        expect(alertedKey()).toBe('workspace:7:credits:2026-12-01:20000000')
    })

    it('never emails a workspace that has no credit and never had one', async () => {
        usage = 0
        vi.mocked(getWorkspaceBudget).mockResolvedValue({ ...BUDGET, budgetMicros: 0 })
        await notifyBudgetExhausted(7)

        expect(db.writes('notifications')).toHaveLength(1)
        expect(sendAlert).not.toHaveBeenCalled()
    })

    it('emails once for good a workspace that spent a one-off credit', async () => {
        vi.mocked(getWorkspaceBudget).mockResolvedValue({ ...BUDGET, budgetMicros: 0 })
        await notifyBudgetExhausted(7)

        expect(alertedKey()).toBe('workspace:7:credits:once:0')
    })

    it.each([
        ['a sandbox', { is_sandbox: true }],
        ['a workspace whose access ended', { subscription_status: 'canceled' }],
    ])('never emails %s', async (_what, row) => {
        Object.assign(tables.workspaces[0], row)
        await notifyBudgetExhausted(7)

        expect(sendAlert).not.toHaveBeenCalled()
    })

    it('does nothing more while the notice of the day stands', async () => {
        tables.notifications = [{ id: 'n', workspace_id: 7, event: 'workspace.budget.exhausted', created_at: new Date().toISOString() }]
        await notifyBudgetExhausted(7)

        expect(sendAlert).not.toHaveBeenCalled()
        expect(db.writes('notifications')).toEqual([])
    })

    it('sends nothing when every admin was already told', async () => {
        vi.mocked(adminsToAlert).mockResolvedValue([])
        await notifyBudgetExhausted(7)

        expect(sendAlert).not.toHaveBeenCalled()
    })
})
