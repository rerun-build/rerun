import { describe, expect, it } from 'vitest'
import { chatRequestSchema } from '@rerun/contracts'

describe('chatRequestSchema thinkingLevel', () => {
    it('accepts low, medium and high', () => {
        for (const level of ['low', 'medium', 'high']) {
            const parsed = chatRequestSchema.safeParse({ message: 'hi', thinkingLevel: level })
            expect(parsed.success).toBe(true)
            expect(parsed.success && parsed.data.thinkingLevel).toBe(level)
        }
    })

    it('accepts a request without thinkingLevel', () => {
        const parsed = chatRequestSchema.safeParse({ message: 'hi' })
        expect(parsed.success).toBe(true)
        expect(parsed.success && parsed.data.thinkingLevel).toBeUndefined()
    })

    it('refuses max, an empty string and a number', () => {
        for (const bad of ['max', '', 3]) {
            expect(chatRequestSchema.safeParse({ message: 'hi', thinkingLevel: bad }).success).toBe(false)
        }
    })

    it('keeps model as an optional string', () => {
        expect(chatRequestSchema.safeParse({ message: 'hi', model: 'some-model' }).success).toBe(true)
        expect(chatRequestSchema.safeParse({ message: 'hi' }).success).toBe(true)
        expect(chatRequestSchema.safeParse({ message: 'hi', model: 5 }).success).toBe(false)
    })
})
