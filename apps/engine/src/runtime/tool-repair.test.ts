import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { repairNullToolInput } from './tool-repair.js'

const schema = z.object({ path: z.string(), encoding: z.string().optional() })

describe('repairNullToolInput', () => {
    it('drops the explicit nulls a model sends for its omitted optional fields', () => {
        const input = JSON.stringify({ path: 'notes.md', encoding: null })
        expect(schema.safeParse(JSON.parse(input)).success).toBe(false)

        const repaired = repairNullToolInput(input)
        expect(repaired).not.toBeNull()
        expect(schema.safeParse(JSON.parse(repaired!)).success).toBe(true)
    })

    it('strips nulls nested in arrays of objects', () => {
        const repaired = repairNullToolInput(JSON.stringify({ secrets: [{ key: 'API_KEY', label: 'API key', help: null, docsUrl: null }], reason: null }))
        expect(JSON.parse(repaired!)).toEqual({ secrets: [{ key: 'API_KEY', label: 'API key' }] })
    })

    it('keeps every non-null value in place', () => {
        const repaired = repairNullToolInput(JSON.stringify({ questions: [{ question: 'Which domain?', options: null }, { question: 'Confirm?', options: ['Yes', 'No'] }] }))
        expect(JSON.parse(repaired!)).toEqual({ questions: [{ question: 'Which domain?' }, { question: 'Confirm?', options: ['Yes', 'No'] }] })
    })

    it('returns null when there is nothing to strip', () => {
        expect(repairNullToolInput(JSON.stringify({ path: 'notes.md' }))).toBeNull()
    })

    it('returns null when the input is not JSON', () => {
        expect(repairNullToolInput('not json')).toBeNull()
        expect(repairNullToolInput('')).toBeNull()
    })
})
