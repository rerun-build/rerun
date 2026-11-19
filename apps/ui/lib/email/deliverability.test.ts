import { describe, expect, it } from 'vitest'
import { undeliverableReason } from './deliverability'

describe('undeliverableReason', () => {
    it('keeps ordinary addresses, including the shapes a strict regex would drop', () => {
        expect(undeliverableReason('someone@gmail.com')).toBeNull()
        expect(undeliverableReason('first.last+newsletter@robagentic.tech')).toBeNull()
        expect(undeliverableReason("o'brien@company.co.uk")).toBeNull()
        expect(undeliverableReason('hey@startup.engineering')).toBeNull()
        expect(undeliverableReason('  Someone@Gmail.com  ')).toBeNull()
    })

    it('catches the address that took the 04/09 batch down', () => {
        expect(undeliverableReason('pentest-run1@example.com')).toBe('reserved domain')
    })

    it('catches every reserved name', () => {
        expect(undeliverableReason('a@example.org')).toBe('reserved domain')
        expect(undeliverableReason('a@example.net')).toBe('reserved domain')
        expect(undeliverableReason('a@mail.example.com')).toBe('reserved domain')
        expect(undeliverableReason('a@anything.test')).toBe('reserved domain')
        expect(undeliverableReason('a@box.invalid')).toBe('reserved domain')
        expect(undeliverableReason('a@printer.local')).toBe('reserved domain')
    })

    it('catches syntax nothing could deliver to', () => {
        expect(undeliverableReason('nobody')).toBe('invalid syntax')
        expect(undeliverableReason('@gmail.com')).toBe('invalid syntax')
        expect(undeliverableReason('someone@')).toBe('invalid syntax')
        expect(undeliverableReason('two@at@gmail.com')).toBe('invalid syntax')
        expect(undeliverableReason('someone@localhost')).toBe('invalid syntax')
        expect(undeliverableReason('someone@gmail..com')).toBe('invalid syntax')
        expect(undeliverableReason('someone@gmail.com.')).toBe('invalid syntax')
        expect(undeliverableReason('a b@gmail.com')).toBe('invalid syntax')
        expect(undeliverableReason('a,b@gmail.com')).toBe('invalid syntax')
    })
})
