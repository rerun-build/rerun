import { describe, expect, it } from 'vitest'
import {
    mcpServerStatusSchema,
    mcpSessionStateSchema,
    mcpSessionStateListSchema,
    mcpReconnectResultSchema,
    mcpReconnectEventSchema,
} from '@moldwright/contracts'

describe('mcp session contract', () => {
    it('accepts each of the four states, with and without an error class', () => {
        for (const state of ['connected', 'connecting', 'failed', 'idle']) {
            expect(mcpSessionStateSchema.safeParse({ name: 'a', state }).success).toBe(true)
            expect(mcpSessionStateSchema.safeParse({ name: 'a', state, errorClass: 'auth' }).success).toBe(true)
        }
        expect(mcpSessionStateListSchema.safeParse({ servers: [{ name: 'a', state: 'idle' }] }).success).toBe(true)
    })

    it('refuses a state or an error class it does not know', () => {
        expect(mcpSessionStateSchema.safeParse({ name: 'a', state: 'reconnecting' }).success).toBe(false)
        expect(mcpSessionStateSchema.safeParse({ name: 'a', state: 'failed', errorClass: 'boom' }).success).toBe(false)
    })

    it('refuses an extra key on a state, so no message text can ride along', () => {
        expect(mcpSessionStateSchema.safeParse({ name: 'a', state: 'failed', error: 'secret' }).success).toBe(false)
    })

    it('accepts a reconnect result for each effect and refuses a negative announced', () => {
        for (const effect of ['next_call', 'next_message']) {
            expect(mcpReconnectResultSchema.safeParse({ name: 'a', reconnected: true, effect, announced: 0 }).success).toBe(true)
        }
        expect(mcpReconnectResultSchema.safeParse({ name: 'a', reconnected: true, effect: 'next_call', announced: -1 }).success).toBe(false)
    })

    it('refuses an unknown key on a reconnect result and on a reconnect event', () => {
        expect(mcpReconnectResultSchema.safeParse({ name: 'a', reconnected: true, effect: 'next_call', announced: 1, x: 1 }).success).toBe(false)
        expect(mcpReconnectEventSchema.safeParse({ name: 'a', effect: 'next_call' }).success).toBe(true)
        expect(mcpReconnectEventSchema.safeParse({ name: 'a', effect: 'next_call', x: 1 }).success).toBe(false)
    })

    it('leaves the status schema as it was', () => {
        expect(mcpServerStatusSchema.safeParse({ name: 'a', status: 'connected', transport: 'http', toolCount: 1 }).success).toBe(true)
        expect(mcpServerStatusSchema.safeParse({ name: 'a', status: 'reconnecting', transport: 'http', toolCount: 1 }).success).toBe(false)
    })
})
