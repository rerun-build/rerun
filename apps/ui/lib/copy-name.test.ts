import { describe, expect, it } from 'vitest'
import { copyOf, duplicateAgentName } from './copy-name'

describe('copyOf', () => {
    it('appends the suffix when there is room', () => {
        expect(copyOf('Research Assistant', 60)).toBe('Research Assistant copy')
    })

    it('trims what it is given rather than suffixing whitespace', () => {
        expect(copyOf('  Scout  ', 60)).toBe('Scout copy')
    })

    it('keeps the result inside the cap', () => {
        expect(copyOf('a'.repeat(80), 20).length).toBeLessThanOrEqual(20)
    })

    it('cuts on a word boundary when one is left', () => {
        expect(copyOf('Quarterly revenue reporter', 20)).toBe('Quarterly copy')
        expect(copyOf('Quarterlyrevenuereporter', 20)).toBe('Quarterlyrevenu copy')
    })

    it('stays inside the cap when a copy is copied again', () => {
        let name = 'Inbox triage'
        for (let i = 0; i < 10; i++) name = duplicateAgentName(name)
        expect(name.length).toBeLessThanOrEqual(60)
        expect(name.endsWith(' copy')).toBe(true)
    })
})
