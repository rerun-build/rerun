import { describe, expect, it, vi } from 'vitest'
import { LinkupError, getMe } from '@/lib/apps/linkup/client'
import { whatsappProfile, whatsappSessionClosed, whatsappSignInRefusal } from './connect'

vi.mock('@/lib/apps/linkup/client', async importOriginal => ({ ...(await importOriginal<typeof import('@/lib/apps/linkup/client')>()), getMe: vi.fn() }))

describe('whatsappProfile', () => {
    it('names the account by its display name and number, and claims the trial on the number', async () => {
        vi.mocked(getMe).mockResolvedValue({ phone_number: '33612345678', jid: '33612345678@s.whatsapp.net', name: 'Jane Doe' })
        await expect(whatsappProfile('acc')).resolves.toEqual({ label: 'Jane Doe (+33612345678)', memberId: '33612345678' })
        vi.mocked(getMe).mockResolvedValue({ phone_number: '33612345678', name: null })
        await expect(whatsappProfile('acc')).resolves.toEqual({ label: '+33612345678', memberId: '33612345678' })
    })
})

describe('whatsappSessionClosed', () => {
    it('reads a closed linked device behind the two codes Linkup hides it in', () => {
        expect(whatsappSessionClosed(new LinkupError('INTERNAL_ERROR', 'Connection Closed', 500))).toBe(true)
        expect(whatsappSessionClosed(new LinkupError('CHANNEL_ERROR', 'Connection Closed', 400))).toBe(true)
    })

    it('leaves every other failure alone', () => {
        expect(whatsappSessionClosed(new LinkupError('CHANNEL_ERROR', 'Chat not found', 400))).toBe(false)
        expect(whatsappSessionClosed(new LinkupError('INTERNAL_ERROR', 'Linkup answered 502 without a body', 502))).toBe(false)
        expect(whatsappSessionClosed(new LinkupError('RATE_LIMITED', 'Connection Closed', 429))).toBe(false)
    })
})

describe('whatsappSignInRefusal', () => {
    it('says what to do when the code ran out', () => {
        expect(whatsappSignInRefusal('WHATSAPP_LINK_EXPIRED').code).toBe('whatsappCodeExpired')
        expect(whatsappSignInRefusal('WHATSAPP_LINK_REFUSED').code).toBe('whatsappLinkRefused')
    })
})
