import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sendTrialStartedEmail } from '@/ee/lib/email/lifecycle-emails'
import { fakeSupabase, type SupabaseResult } from '@/test/supabase-fake'
import { loadRecipient } from './recipient'
import { sendTrialStartedReceipt } from './trial-receipt'

vi.mock('@/ee/lib/email/lifecycle-emails', () => ({ sendTrialStartedEmail: vi.fn() }))
vi.mock('./recipient', () => ({ loadRecipient: vi.fn() }))
vi.mock('@/lib/email/board-banner', () => ({ BANNER_WARM_INLINE_MS: 0, emailBoardBanner: vi.fn(async () => undefined) }))

type Tables = { workspaces?: SupabaseResult; workspace_members?: SupabaseResult; users?: SupabaseResult; lifecycle_emails?: SupabaseResult }

function database(overrides: Tables = {}) {
    const tables: Tables = {
        workspaces: { data: { id: 1, name: 'Acme', is_sandbox: false } },
        workspace_members: { data: [{ user_id: 'owner' }] },
        users: { data: { id: 'owner', email_notification_prefs: null } },
        lifecycle_emails: {},
        ...overrides,
    }
    return fakeSupabase(table => tables[table as keyof Tables])
}

function receipt(db: ReturnType<typeof database>) {
    return sendTrialStartedReceipt(db.client, 1, '2026-09-23T12:00:00.000Z', 3, true)
}

describe('sendTrialStartedReceipt', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.stubEnv('UNSUBSCRIBE_SECRET', 'secret')
        vi.spyOn(console, 'error').mockImplementation(() => {})
        vi.mocked(loadRecipient).mockResolvedValue({ email: 'owner@example.com', firstName: null })
        vi.mocked(sendTrialStartedEmail).mockResolvedValue({ ok: true, id: 'email_1' })
    })
    afterEach(() => vi.unstubAllEnvs())

    it('claims the slot before sending the receipt to the owner', async () => {
        const db = database()
        let claimedBeforeSend = false
        vi.mocked(sendTrialStartedEmail).mockImplementation(async () => {
            claimedBeforeSend = db.writes('lifecycle_emails').length === 1
            return { ok: true, id: 'email_1' }
        })

        await receipt(db)

        expect(claimedBeforeSend).toBe(true)
        expect(db.writes('lifecycle_emails')[0].payload).toMatchObject({ user_id: 'owner', workspace_id: 1, sequence_key: 'trial_started', status: 'sent' })
        expect(sendTrialStartedEmail).toHaveBeenCalledWith(
            { to: 'owner@example.com', unsubscribeUrl: expect.stringMatching(/&category=billing$/), locale: 'en' },
            expect.objectContaining({ workspaceName: 'Acme', trialDays: 3, trialEndsLabel: '23 September', includedLabel: '3 coworkers and 350 credits' }),
        )
    })

    it('quotes the price of the arm the workspace was drawn into, the default price without one', async () => {
        await receipt(database({ workspaces: { data: { id: 1, name: 'Acme', is_sandbox: false, price_arm: '49' } } }))
        await receipt(database())

        expect(vi.mocked(sendTrialStartedEmail).mock.calls.map(([, props]) => props.monthlyPriceLabel)).toEqual(['$49', '$29'])
    })

    it('sends nothing when another webhook already claimed the slot', async () => {
        const db = database({ lifecycle_emails: { error: { code: '23505', message: 'duplicate' } } })

        await receipt(db)

        expect(sendTrialStartedEmail).not.toHaveBeenCalled()
    })

    it('skips a sandbox', async () => {
        const db = database({ workspaces: { data: { id: 1, name: 'Sandbox', is_sandbox: true } } })

        await receipt(db)

        expect(db.writes('lifecycle_emails')).toEqual([])
        expect(sendTrialStartedEmail).not.toHaveBeenCalled()
    })

    it('skips an owner who opted out of billing emails', async () => {
        const db = database({ users: { data: { id: 'owner', email_notification_prefs: { categories: { billing: false } } } } })

        await receipt(db)

        expect(db.writes('lifecycle_emails')).toEqual([])
        expect(sendTrialStartedEmail).not.toHaveBeenCalled()
    })

    it('skips a workspace without members', async () => {
        const db = database({ workspace_members: { data: [] } })

        await receipt(db)

        expect(sendTrialStartedEmail).not.toHaveBeenCalled()
    })

    it('never throws into the webhook', async () => {
        const db = database()
        vi.mocked(loadRecipient).mockRejectedValue(new Error('auth down'))

        await expect(receipt(db)).resolves.toBeUndefined()
    })
})
