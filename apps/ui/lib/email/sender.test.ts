import { RERUN_BRAND, type Brand } from '@rerun/contracts'
import { describe, expect, it } from 'vitest'
import { MARKETING_FROM, REPLY_TO, TRANSACTIONAL_FROM } from './client'
import { emailSender, senderName } from './sender'

const AGENCY: Brand = { ...RERUN_BRAND, organizationId: 'org', name: 'Nordlys', supportEmail: 'help@nordlys.no' }

describe('emailSender', () => {
    it('leaves the senders of Rerun as they are', () => {
        expect(emailSender(RERUN_BRAND)).toEqual({ from: TRANSACTIONAL_FROM, replyTo: REPLY_TO })
        expect(emailSender(RERUN_BRAND, MARKETING_FROM)).toEqual({ from: MARKETING_FROM, replyTo: REPLY_TO })
    })

    it('signs with the name of the organization, from the same address', () => {
        expect(emailSender(AGENCY, 'Rerun <hey@mail.test>')).toEqual({ from: '"Nordlys" <hey@mail.test>', replyTo: 'help@nordlys.no' })
        expect(emailSender(AGENCY, 'hey@mail.test').from).toBe('"Nordlys" <hey@mail.test>')
    })

    it('never sends the replies of an organization to Rerun', () => {
        expect(emailSender({ ...AGENCY, supportEmail: null }).replyTo).toBeUndefined()
    })

    it('falls back on the address alone when nothing is left of the name', () => {
        expect(emailSender({ ...AGENCY, name: '"<>"' }, 'Rerun <hey@mail.test>').from).toBe('hey@mail.test')
    })
})

describe('senderName', () => {
    it.each([
        ['Nordlys & Søn, AS', 'Nordlys & Søn, AS'],
        ['Acme" <evil@x.io>', 'Acme evil@x.io'],
        ['Acme\r\nBcc: evil@x.io', 'Acme Bcc: evil@x.io'],
        ['Acme \u0000​Studio', 'Acme Studio'],
        ['Back\\slash', 'Backslash'],
        ['  \t ', ''],
    ])('reads %j as %j', (name, expected) => {
        expect(senderName(name)).toBe(expected)
    })

    it('keeps a header short without cutting a character in two', () => {
        const name = senderName('🦊'.repeat(100))
        expect([...name]).toHaveLength(64)
        expect(name).toBe('🦊'.repeat(64))
    })
})
