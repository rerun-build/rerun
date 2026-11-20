import { describe, expect, it } from 'vitest'
import { createAiConnectionInputSchema, createConnectionSchema, updateConnectionSchema } from '@moldwright/contracts'

describe('a connection base URL', () => {
    it('is refused when it carries a username or password', () => {
        for (const baseUrl of ['https://user:pass@router.example/api/v1', 'https://user@router.example/api/v1', 'https://:pass@router.example/api/v1']) {
            expect(updateConnectionSchema.safeParse({ baseUrl }).success).toBe(false)
            expect(createConnectionSchema.safeParse({ name: 'r', provider: 'openrouter', baseUrl }).success).toBe(false)
            expect(createAiConnectionInputSchema.safeParse({ provider: 'custom', baseUrl }).success).toBe(false)
        }
    })

    it('is taken when plain or empty', () => {
        expect(updateConnectionSchema.safeParse({ baseUrl: 'https://router.example/api/v1' }).success).toBe(true)
        expect(updateConnectionSchema.safeParse({ baseUrl: '' }).success).toBe(true)
        expect(createConnectionSchema.safeParse({ name: 'r', provider: 'custom', baseUrl: 'http://localhost:11434/v1' }).success).toBe(true)
    })
})
