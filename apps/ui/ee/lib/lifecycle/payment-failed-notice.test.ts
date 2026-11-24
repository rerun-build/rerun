import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RERUN_BRAND } from '@rerun/contracts'
import { sendPaymentFailedEmail } from '@/ee/lib/email/lifecycle-emails'
import { deliverWhatsApp } from '@/lib/whatsapp/send'
import { fakeSupabase, type SupabaseResult } from '@/test/supabase-fake'
import { sendPaymentFailedNotice, type DeclinedInvoice } from './payment-failed-notice'
import { loadRecipient } from './recipient'

vi.mock('@/ee/lib/email/lifecycle-emails', () => ({ sendPaymentFailedEmail: vi.fn() }))
vi.mock('./recipient', () => ({ loadRecipient: vi.fn() }))
vi.mock('@/lib/whatsapp/send', () => ({ deliverWhatsApp: vi.fn() }))
vi.mock('@/lib/email/board-banner', () => ({ BANNER_WARM_INLINE_MS: 0, alertBanner: vi.fn(async () => 'https://app.rerun.build/og/board?sig=banner') }))
vi.mock('@/lib/og/board-image', () => ({ boardImageUrl: vi.fn((scene: unknown) => `https://app.rerun.build/og/board?scene=${JSON.stringify(scene)}`) }))

type Tables = { workspaces?: SupabaseResult; workspace_members?: SupabaseResult; lifecycle_emails?: SupabaseResult; agents?: SupabaseResult }

const NOW = new Date('2026-10-05T06:10:00.000Z')
const INVOICE: DeclinedInvoice = { id: 'in_1', amountDueCents: 1762, currency: 'usd', hostedUrl: 'https://pay.stripe.test/in_1', firstCharge: false }

function database(overrides: Tables = {}) {
    const tables: Tables = {
        workspaces: { data: { id: 1, name: 'Acme', is_sandbox: false, trial_ends_at: '2026-09-01T00:00:00Z' } },
        workspace_members: { data: [{ user_id: 'owner' }] },
        lifecycle_emails: {},
        agents: { data: [{ id: 'a1', name: 'Lead Scout' }, { id: 'a2', name: 'Inbox Assistant' }] },
        ...overrides,
    }
    return fakeSupabase(table => tables[table as keyof Tables])
}

describe('sendPaymentFailedNotice', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.spyOn(console, 'error').mockImplementation(() => {})
        vi.mocked(loadRecipient).mockResolvedValue({ email: 'owner@example.com', firstName: null })
        vi.mocked(sendPaymentFailedEmail).mockResolvedValue({ ok: true, id: 'email_1' })
        vi.mocked(deliverWhatsApp).mockResolvedValue({ sent: true, id: 'row-1' })
    })

    it('sends the amount, the invoice link and when the coworkers stop, with no opt-out', async () => {
        const db = database()

        await sendPaymentFailedNotice(db.client, 1, INVOICE, NOW)

        expect(sendPaymentFailedEmail).toHaveBeenCalledWith(
            { to: 'owner@example.com', unsubscribeUrl: null, locale: 'en', brand: RERUN_BRAND },
            { workspaceName: 'Acme', amountLabel: '$17.62', pausedLabel: '6 October, 06:10 UTC', firstCharge: false, billingUrl: 'https://pay.stripe.test/in_1', boardUrl: 'https://app.rerun.build/og/board?sig=banner' },
        )
        expect(db.writes('lifecycle_emails')[0].payload).toMatchObject({ user_id: 'owner', workspace_id: 1, sequence_key: 'payment_failed', status: 'sent', metadata: { invoice_id: 'in_1' } })
    })

    it('messages the owner on WhatsApp with the team that stops, once per invoice', async () => {
        const db = database()

        await sendPaymentFailedNotice(db.client, 1, INVOICE, NOW)

        expect(deliverWhatsApp).toHaveBeenCalledWith(db.client, {
            userId: 'owner',
            workspaceId: 1,
            message: expect.objectContaining({
                slug: 'rerun_payment_failed',
                components: [
                    { type: 'header', parameters: [{ type: 'image', url: expect.stringContaining('"name":"Lead Scout","status":"working"') }] },
                    { type: 'body', parameters: [{ type: 'text', name: 'team', text: 'Lead Scout and Inbox Assistant' }] },
                    { type: 'button', parameters: [{ type: 'text', text: '?billing=1&ref=whatsapp&wa=payment_failed' }] },
                ],
            }),
            language: 'en',
            dedupeKey: 'payment_failed:in_1',
        })
    })

    it('still messages an owner who has no address to email', async () => {
        vi.mocked(loadRecipient).mockResolvedValue(null)

        await sendPaymentFailedNotice(database().client, 1, INVOICE, NOW)

        expect(sendPaymentFailedEmail).not.toHaveBeenCalled()
        expect(deliverWhatsApp).toHaveBeenCalled()
    })

    it("leaves a trial's first charge to the trial_ended email, and messages it all the same", async () => {
        const db = database()

        await sendPaymentFailedNotice(db.client, 1, { ...INVOICE, firstCharge: true }, NOW)

        expect(sendPaymentFailedEmail).not.toHaveBeenCalled()
        expect(db.writes('lifecycle_emails')).toEqual([])
        expect(deliverWhatsApp).toHaveBeenCalled()
    })

    it('writes to every admin, and messages the owner alone', async () => {
        const db = database({ workspace_members: { data: [{ user_id: 'owner' }, { user_id: 'second' }] } })

        await sendPaymentFailedNotice(db.client, 1, INVOICE, NOW)

        expect(sendPaymentFailedEmail).toHaveBeenCalledTimes(2)
        expect(db.writes('lifecycle_emails').map(write => (write.payload as { user_id: string }).user_id)).toEqual(['owner', 'second'])
        expect(deliverWhatsApp).toHaveBeenCalledTimes(1)
    })

    it('emails a first charge no trial_ended email would ever follow', async () => {
        const db = database({ workspaces: { data: { id: 1, name: 'Acme', is_sandbox: false, trial_ends_at: null } } })

        await sendPaymentFailedNotice(db.client, 1, { ...INVOICE, firstCharge: true }, NOW)

        expect(sendPaymentFailedEmail).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ firstCharge: true }))
    })

    it('falls back to the billing dialog when Stripe gave no hosted page', async () => {
        await sendPaymentFailedNotice(database().client, 1, { ...INVOICE, hostedUrl: null }, NOW)

        expect(sendPaymentFailedEmail).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ billingUrl: expect.stringMatching(/\/\?workspace=1&billing=1$/) }))
    })

    it('records a failed delivery as failed', async () => {
        const db = database()
        vi.mocked(sendPaymentFailedEmail).mockResolvedValue({ ok: false, error: 'bounced' })

        await sendPaymentFailedNotice(db.client, 1, INVOICE, NOW)

        expect(db.writes('lifecycle_emails')[0].payload).toMatchObject({ status: 'failed' })
    })

    it('skips a sandbox', async () => {
        await sendPaymentFailedNotice(database({ workspaces: { data: { id: 1, name: 'Sandbox', is_sandbox: true } } }).client, 1, INVOICE, NOW)

        expect(sendPaymentFailedEmail).not.toHaveBeenCalled()
        expect(deliverWhatsApp).not.toHaveBeenCalled()
    })

    it('never throws into the webhook', async () => {
        vi.mocked(sendPaymentFailedEmail).mockRejectedValue(new Error('resend down'))

        await expect(sendPaymentFailedNotice(database().client, 1, INVOICE, NOW)).resolves.toBeUndefined()
    })
})
