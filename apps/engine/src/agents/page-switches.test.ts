import { describe, expect, it } from 'vitest'
import { agentConfigSchema } from '@moldwright/contracts'

const base = { name: 'a' }

describe('page switches', () => {
    it('leaves pages absent when not set', () => {
        const parsed = agentConfigSchema.parse(base)
        expect('pages' in parsed).toBe(false)
        expect(JSON.stringify(agentConfigSchema.parse(JSON.parse(JSON.stringify(parsed))))).toBe(JSON.stringify(parsed))
    })
    it('round-trips skim: true', () => {
        const parsed = agentConfigSchema.parse({ ...base, pages: { skim: true } })
        expect(agentConfigSchema.parse(JSON.parse(JSON.stringify(parsed))).pages).toEqual({ skim: true })
    })
    it('refuses standingInstructions: true', () => {
        expect(agentConfigSchema.safeParse({ ...base, pages: { standingInstructions: true } }).success).toBe(false)
        expect(agentConfigSchema.safeParse({ ...base, pages: { standingInstructions: false } }).success).toBe(true)
    })
    it('refuses unknown switches', () => {
        expect(agentConfigSchema.safeParse({ ...base, pages: { oldToolOutput: true } }).success).toBe(false)
    })
})
