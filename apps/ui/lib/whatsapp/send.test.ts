import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase } from '@/test/supabase-fake'
import { sendWhatsAppTemplate } from './client'
import { loadWhatsAppRecipient } from './recipient'
import { deliverWhatsApp } from './send'
import { applyWhatsAppFailure, claimWhatsAppMessage, markWhatsAppMessageAccepted, releaseWhatsAppMessage } from './store'
import { paymentFailedMessage } from './templates'

vi.mock('./client', () => ({ sendWhatsAppTemplate: vi.fn() }))
vi.mock('./recipient', () => ({ loadWhatsAppRecipient: vi.fn() }))
vi.mock('./store', () => ({ applyWhatsAppFailure: vi.fn(), claimWhatsAppMessage: vi.fn(), markWhatsAppMessageAccepted: vi.fn(), releaseWhatsAppMessage: vi.fn() }))

const MESSAGE = paymentFailedMessage({ imageUrl: 'https://moldwright.robagentic.tech/og/board?scene=x', team: 'Inbox Assistant', path: 'w/acme?billing=1' })

const deliver = () => deliverWhatsApp(fakeSupabase().client, { userId: 'user-1', workspaceId: 7, agentId: 'agent-1', message: MESSAGE, language: 'fr', dedupeKey: 'payment_failed:in_1' })

beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(loadWhatsAppRecipient).mockResolvedValue({ ok: true, phone: '+32492000000' })
    vi.mocked(claimWhatsAppMessage).mockResolvedValue({ outcome: 'claimed', id: 'row-1' })
    vi.mocked(sendWhatsAppTemplate).mockResolvedValue({ ok: true, id: 'wam_1' })
})

describe('deliverWhatsApp', () => {
    it('claims the row, sends under its id, and keeps what Bird answered', async () => {
        expect(await deliver()).toEqual({ sent: true, id: 'row-1' })

        expect(vi.mocked(loadWhatsAppRecipient).mock.calls[0].slice(1)).toEqual(['user-1', 'utility'])
        expect(vi.mocked(claimWhatsAppMessage).mock.calls[0][1]).toEqual({ userId: 'user-1', workspaceId: 7, agentId: 'agent-1', phone: '+32492000000', message: MESSAGE, language: 'fr', dedupeKey: 'payment_failed:in_1' })
        expect(sendWhatsAppTemplate).toHaveBeenCalledWith({
            to: '+32492000000',
            slug: 'rerun_payment_failed',
            language: 'fr',
            components: MESSAGE.components,
            idempotencyKey: 'whatsapp:row-1',
            tags: [{ name: 'template', value: 'payment_failed' }],
            metadata: { message_id: 'row-1' },
        })
        expect(vi.mocked(markWhatsAppMessageAccepted).mock.calls[0].slice(1)).toEqual(['row-1', 'wam_1'])
    })

    it('writes nothing and sends nothing to someone it may not write to', async () => {
        vi.mocked(loadWhatsAppRecipient).mockResolvedValue({ ok: false, reason: 'opted_out' })

        expect(await deliver()).toEqual({ sent: false, reason: 'opted_out' })
        expect(claimWhatsAppMessage).not.toHaveBeenCalled()
        expect(sendWhatsAppTemplate).not.toHaveBeenCalled()
    })

    it.each([
        ['duplicate', 'duplicate'],
        ['failed', 'record_failed'],
    ] as const)('does not send when the claim comes back %s', async (outcome, reason) => {
        vi.mocked(claimWhatsAppMessage).mockResolvedValue({ outcome })

        expect(await deliver()).toEqual({ sent: false, reason })
        expect(sendWhatsAppTemplate).not.toHaveBeenCalled()
    })

    it.each([
        [{ ok: true, id: null, skipped: true } as const, 'delivery_disabled'],
        [{ ok: false, error: 'rate_limited', detail: '429' } as const, 'rate_limited'],
    ])('gives the row back when nothing left: %o', async (result, reason) => {
        vi.mocked(sendWhatsAppTemplate).mockResolvedValue(result)

        expect(await deliver()).toEqual({ sent: false, reason })
        expect(vi.mocked(releaseWhatsAppMessage).mock.calls[0][1]).toBe('row-1')
        expect(applyWhatsAppFailure).not.toHaveBeenCalled()
    })

    it('keeps the row of a send Bird refused, with the reason', async () => {
        vi.mocked(sendWhatsAppTemplate).mockResolvedValue({ ok: false, error: 'rejected', detail: '422 E15023 Sender mismatch' })

        expect(await deliver()).toEqual({ sent: false, reason: 'rejected' })
        expect(releaseWhatsAppMessage).not.toHaveBeenCalled()
        expect(vi.mocked(applyWhatsAppFailure).mock.calls[0].slice(1)).toEqual(['row-1', expect.objectContaining({ status: 'rejected', code: 'rejected', description: '422 E15023 Sender mismatch' })])
    })
})
