import { RERUN_BRAND, type Brand } from '@rerun/contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const send = vi.fn()
vi.mock('@/lib/email/client', async importOriginal => ({ ...(await importOriginal<typeof import('@/lib/email/client')>()), getResendClient: () => ({ emails: { send } }) }))

import { REPLY_TO, TRANSACTIONAL_FROM } from '@/lib/email/client'
import { sendAccountSignedOutEmail, sendBudgetExhaustedEmail, sendNotificationEmail, sendPublishedAccessCodeEmail, sendSignInCodeEmail, sendWorkspaceInviteEmail } from './email.service'

const AGENCY: Brand = { ...RERUN_BRAND, organizationId: 'org', name: 'Nordlys', iconUrl: 'https://cdn.example/icon.png', supportEmail: 'help@nordlys.no' }

const EMAILS: [string, (brand?: Brand) => Promise<unknown>][] = [
    ['a notification', brand => sendNotificationEmail({ to: 'ada@acme.com', kind: 'question', agentName: 'Atlas', message: 'Which one?', brand })],
    ['a failed run', brand => sendNotificationEmail({ to: 'ada@acme.com', kind: 'error', agentName: 'Atlas', message: 'It broke', brand })],
    ['the end of the credit', brand => sendBudgetExhaustedEmail({ to: 'ada@acme.com', workspaceName: 'Acme', creditsUrl: 'https://app.example/?billing=1', brand })],
    ['a signed-out account', brand => sendAccountSignedOutEmail({ to: 'ada@acme.com', kind: 'subscription', account: 'Claude', coworkers: ['Atlas'], workspaceName: 'Acme', reconnectUrl: 'https://app.example/?reconnect=1', brand })],
    ['an invitation', brand => sendWorkspaceInviteEmail({ to: 'ada@acme.com', workspaceName: 'Acme', inviteUrl: 'https://agents.nordlys.no/invite/x', brand })],
    ['the code of a published page', brand => sendPublishedAccessCodeEmail({ to: 'ada@acme.com', code: '123456', workspaceName: 'Acme', pageTitle: 'Report', expiresInMinutes: 10, brand })],
    ['a sign-in code', brand => sendSignInCodeEmail({ to: 'ada@acme.com', code: '123456', expiresInMinutes: 15, brand })],
]

beforeEach(() => {
    vi.stubEnv('EMAIL_REDIRECT_TO', '')
    send.mockReset().mockResolvedValue({ data: { id: 'email_1' }, error: null })
})

describe('the brand of an email', () => {
    it.each(EMAILS)('is Rerun by default on %s', async (_name, sendEmail) => {
        await sendEmail()
        const [email] = send.mock.calls[0]
        expect([email.from, email.replyTo]).toEqual([TRANSACTIONAL_FROM, REPLY_TO])
        expect(email.html).toContain('© 2026 Rerun')
    })

    it.each(EMAILS)('is the organization on %s', async (_name, sendEmail) => {
        await sendEmail(AGENCY)
        const [email] = send.mock.calls[0]
        expect(email.from).toMatch(/^"Nordlys" <[^<>]+@[^<>]+>$/)
        expect(email.replyTo).toBe('help@nordlys.no')
        expect(email.subject).not.toContain('Rerun')
        expect(email.html).toContain('© 2026 Nordlys')
        expect(email.text).not.toMatch(/\bRerun\b/)
    })
})
