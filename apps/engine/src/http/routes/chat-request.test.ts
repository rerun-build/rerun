import { describe, expect, it } from 'vitest'
import { agentConfigSchema, chatRequestSchema } from '@moldwright/contracts'

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

describe('chatRequestSchema contextSize', () => {
    it('accepts small, medium and large', () => {
        for (const size of ['small', 'medium', 'large']) {
            const parsed = chatRequestSchema.safeParse({ message: 'hi', contextSize: size })
            expect(parsed.success && parsed.data.contextSize).toBe(size)
        }
    })

    it('accepts a request without contextSize', () => {
        const parsed = chatRequestSchema.safeParse({ message: 'hi' })
        expect(parsed.success && parsed.data.contextSize).toBeUndefined()
    })

    it('refuses an unknown size, an empty string and a number', () => {
        for (const bad of ['huge', '', 480000]) {
            expect(chatRequestSchema.safeParse({ message: 'hi', contextSize: bad }).success).toBe(false)
        }
    })
})

describe('agentConfigSchema contextSize', () => {
    it('keeps a valid size, leaves it unset by default and refuses an unknown one', () => {
        expect(agentConfigSchema.parse({ name: 'a', contextSize: 'large' }).contextSize).toBe('large')
        expect(agentConfigSchema.parse({ name: 'a' }).contextSize).toBeUndefined()
        expect(agentConfigSchema.safeParse({ name: 'a', contextSize: 'huge' }).success).toBe(false)
    })
})

describe('chatRequestSchema copyIndex', () => {
    it('accepts a whole number from 1 to 64', () => {
        for (const copyIndex of [1, 2, 64]) {
            const parsed = chatRequestSchema.safeParse({ message: 'hi', copyIndex })
            expect(parsed.success && parsed.data.copyIndex).toBe(copyIndex)
        }
    })

    it('refuses 0, 65, 1.5 and a string', () => {
        for (const bad of [0, 65, 1.5, '2']) {
            expect(chatRequestSchema.safeParse({ message: 'hi', copyIndex: bad }).success).toBe(false)
        }
    })
})
