import { describe, expect, it } from 'vitest'
import { factoryDigestSchema } from '@rerun/contracts'

const base = () => ({
    stations: [],
    threads: [],
    anomalies: [],
    measures: {
        mergedPerHour: 0,
        leadTimeS: null,
        firstPassYield: null,
        fixRounds: null,
        blocks: { blocked: 0, rejected: 0, failed: 0, returned: 0 },
        tokensPerMerged: null,
    },
})

const issues = () => ({ open: { P0: 2, P1: 5, P2: 0, P3: 1, none: 9 }, classifiedToday: 4, joinedToday: 3 })

describe('factoryDigestSchema issue counts', () => {
    it('accepts a digest without issues', () => {
        expect(factoryDigestSchema.safeParse(base()).success).toBe(true)
    })

    it('keeps the issue counts of the classifier', () => {
        const parsed = factoryDigestSchema.parse({ ...base(), issues: issues() })
        expect(parsed.issues).toEqual(issues())
    })

    it('refuses a negative or fractional count', () => {
        const bad = [
            { ...issues(), joinedToday: -1 },
            { ...issues(), classifiedToday: 1.5 },
            { ...issues(), open: { ...issues().open, P2: -1 } },
        ]
        for (const value of bad) expect(factoryDigestSchema.safeParse({ ...base(), issues: value }).success).toBe(false)
    })

    it('refuses a priority or a key it does not know', () => {
        const { open, ...withoutOpen } = issues()
        const bad = [
            { ...issues(), open: { ...open, P4: 1 } },
            { ...issues(), closedToday: 1 },
            withoutOpen,
        ]
        for (const value of bad) expect(factoryDigestSchema.safeParse({ ...base(), issues: value }).success).toBe(false)
    })
})
