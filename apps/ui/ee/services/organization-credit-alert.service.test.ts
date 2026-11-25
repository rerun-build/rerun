import { MICROS_PER_CREDIT } from '@rerun/contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ADMIN, CLIENT, CLIENT_ADMIN, NORDLYS, organizationContext, organizationTables, organizationWorld, OWNER, RIVAL, workspaceRow, type OrganizationWorld } from '@/ee/test/organization-world'
import type { SupabaseCall } from '@/test/supabase-fake'
import { writeMethodOf } from '@/test/supabase-fake'

const mocks = vi.hoisted(() => ({ client: null as unknown, send: vi.fn(), budgetEmail: vi.fn() }))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: () => mocks.client }))
vi.mock('@/supabase/session/getServerSession', () => ({ getSessionIdentity: vi.fn() }))
vi.mock('@rerun/cloud/organizations', () => ({ ORGANIZATIONS_ENABLED: true }))
vi.mock('@rerun/cloud/organizations.server', async () => ({ organizationBrandOfWorkspace: (await import('./organization-brand.service')).organizationBrandOfWorkspace }))
vi.mock('@/app/api/_services/remote-computers.service', () => ({ revokeMemberComputers: vi.fn() }))
vi.mock('@/app/api/_services/email.service', () => ({ sendOrganizationCreditOutEmail: mocks.send, sendBudgetExhaustedEmail: mocks.budgetEmail }))
vi.mock('@/lib/email/board-banner', () => ({ BANNER_WARM_BACKGROUND_MS: 0, emailBoardBanner: async () => undefined, alertBanner: async () => undefined }))
vi.mock('@/lib/og/alert-crew', () => ({ causeAlertBoard: async () => null }))
vi.mock('@/lib/email/unsubscribeToken', () => ({ buildUnsubscribeUrl: (id: string) => `https://app.rerun.test/unsubscribe?u=${id}` }))

const { notifyBudgetExhausted } = await import('./budgetNotification.service')
const { allocateOrganizationCredit, purchaseOrganizationCredit, takeBackOrganizationCredit } = await import('./organization-credit.service')

// `.test` is a reserved domain, which no email is ever sent to.
const INBOXES = { [OWNER]: 'owner@nordlys.io', [ADMIN]: 'admin@nordlys.io', [RIVAL]: 'owner@havre.io', [CLIENT_ADMIN]: 'client@acme.io' }

const request = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

let world: OrganizationWorld

type Before = (table: string, calls: readonly SupabaseCall[]) => { error: unknown } | undefined | void

function open({ client = {}, before }: { client?: Record<string, unknown>; before?: Before } = {}): void {
    const tables = organizationTables({ notifications: [] })
    tables.users = tables.users.map(user => ({ email_notification_prefs: null, ...user }))
    world = organizationWorld({ ...tables, workspaces: [...tables.workspaces.filter(row => row.id !== CLIENT), workspaceRow(CLIENT, { name: 'Acme', is_sandbox: false, rerun_credit_paused_at: null, organization_credit_alerted_at: null, ...client })] }, before, INBOXES)
    mocks.client = world.client
}

const clientRow = () => world.rows('workspaces').find(row => row.id === CLIENT)!
const spendEverything = () => Object.assign(clientRow(), { rerun_topup_micros: 0 })
const reached = () => mocks.send.mock.calls.map(([email]) => email.to).sort()

beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.send.mockResolvedValue({ ok: true, id: 'email_1' })
    mocks.budgetEmail.mockResolvedValue({ ok: true, id: 'email_1' })
    open()
})

describe('a workspace of an organization that runs out of credit', () => {
    it('writes once to the owners and admins of its organization, in its name', async () => {
        await notifyBudgetExhausted(CLIENT)

        expect(mocks.send).toHaveBeenCalledTimes(2)
        expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ workspaceName: 'Acme', consoleUrl: expect.stringMatching(new RegExp(`/organization/workspaces/${CLIENT}$`)), brand: expect.objectContaining({ organizationId: NORDLYS, name: 'Nordlys' }) }))
        expect(mocks.budgetEmail).not.toHaveBeenCalled()
        expect(clientRow().organization_credit_alerted_at).toEqual(expect.any(String))

        await notifyBudgetExhausted(CLIENT)
        await notifyBudgetExhausted(CLIENT)
        expect(mocks.send).toHaveBeenCalledTimes(2)
    })

    it('writes once when several calls are refused at the same time', async () => {
        await Promise.all([notifyBudgetExhausted(CLIENT), notifyBudgetExhausted(CLIENT), notifyBudgetExhausted(CLIENT)])
        expect(mocks.send).toHaveBeenCalledTimes(2)
    })

    it('never reaches another organization, nor the people of the workspace', async () => {
        await notifyBudgetExhausted(CLIENT)
        const asked = world.rows('organization_members').filter(row => row.organization_id === NORDLYS).map(row => row.user_id)
        expect(asked.sort()).toEqual([OWNER, ADMIN].sort())
        expect(asked).not.toContain(RIVAL)
        expect(reached()).toHaveLength(2)
    })

    it('tells its members who to contact, in the app', async () => {
        await notifyBudgetExhausted(CLIENT)
        const [notice] = world.rows('notifications')
        expect(notice).toMatchObject({ workspace_id: CLIENT, metadata: { notice: { key: 'managedCreditOut', values: { manager: 'Nordlys' } } } })
        expect(notice.message).not.toContain('Rerun')
        expect(Object.keys(notice.recipients as object)).not.toContain(OWNER)
    })

    it('writes again after an allocation that ran out in turn', async () => {
        await notifyBudgetExhausted(CLIENT)
        await purchaseOrganizationCredit(world.client, { organizationId: NORDLYS, credits: 500, actorUserId: null, requestId: request(1) })
        await allocateOrganizationCredit(organizationContext(world), { workspaceId: CLIENT, credits: 100, requestId: request(2) })
        expect(clientRow().organization_credit_alerted_at).toBeNull()

        spendEverything()
        await notifyBudgetExhausted(CLIENT)
        expect(mocks.send).toHaveBeenCalledTimes(4)
    })

    it('is not rearmed by taking credit back', async () => {
        open({ client: { rerun_topup_micros: 50 * MICROS_PER_CREDIT, organization_credit_alerted_at: '2026-11-20T00:00:00.000Z' } })
        await takeBackOrganizationCredit(organizationContext(world), { workspaceId: CLIENT, credits: 50, requestId: request(3) })
        await notifyBudgetExhausted(CLIENT)
        expect(mocks.send).not.toHaveBeenCalled()
    })

    it('says nothing when credit came in since the call was refused, and stays armed', async () => {
        open({ client: { rerun_topup_micros: 10 * MICROS_PER_CREDIT } })
        await notifyBudgetExhausted(CLIENT)
        expect(mocks.send).not.toHaveBeenCalled()
        expect(clientRow().organization_credit_alerted_at).toBeNull()
    })

    it('tries again on the next refused call when nobody could be reached', async () => {
        mocks.send.mockResolvedValue({ ok: false, error: 'resend down' })
        await notifyBudgetExhausted(CLIENT)
        expect(clientRow().organization_credit_alerted_at).toBeNull()

        mocks.send.mockResolvedValue({ ok: true, id: 'email_2' })
        await notifyBudgetExhausted(CLIENT)
        expect(clientRow().organization_credit_alerted_at).toEqual(expect.any(String))
    })

    it('leaves out whoever turned billing emails off', async () => {
        Object.assign(world.rows('users').find(row => row.id === ADMIN)!, { email_notification_prefs: { categories: { billing: false } } })
        await notifyBudgetExhausted(CLIENT)
        expect(mocks.send).toHaveBeenCalledTimes(1)
    })

    it('still tells its members when the alert could not be taken', async () => {
        open({ before: (table, calls) => (table === 'workspaces' && writeMethodOf(calls) === 'update' ? { error: { message: 'database down' } } : undefined) })
        await notifyBudgetExhausted(CLIENT)
        expect(mocks.send).not.toHaveBeenCalled()
        expect(world.rows('notifications')).toHaveLength(1)
    })
})

describe('a workspace of its own that runs out of credit', () => {
    it('writes to its admins, and alerts no organization', async () => {
        open({ client: { organization_id: null, plan: 'base', rerun_budget_micros: 10 * MICROS_PER_CREDIT, rerun_used_micros: 10 * MICROS_PER_CREDIT } })
        await notifyBudgetExhausted(CLIENT)
        expect(mocks.send).not.toHaveBeenCalled()
        expect(mocks.budgetEmail).toHaveBeenCalledTimes(1)
        expect(mocks.budgetEmail).toHaveBeenCalledWith(expect.objectContaining({ to: INBOXES[CLIENT_ADMIN] }))
        expect(world.rows('notifications')[0]).toMatchObject({ metadata: { notice: { key: 'budgetExhausted' } } })
        expect(clientRow().organization_credit_alerted_at).toBeNull()
    })
})
