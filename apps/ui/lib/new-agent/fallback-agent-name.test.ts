import { describe, expect, it } from 'vitest'

import { AGENT_NAME_MAX, fallbackAgentName } from '@moldwright/ui/new-agent'

describe('fallbackAgentName', () => {
    it('takes the name the text declares', () => {
        expect(fallbackAgentName('You are Gig Applier, working for Haroon Haneef.')).toBe('Gig Applier')
        expect(fallbackAgentName('You are Tracker, working for Haroon Haneef.')).toBe('Tracker')
    })

    it('stops at the end of the first clause rather than in the middle of a sentence', () => {
        expect(fallbackAgentName('Every morning, sort our hello@ inbox and tell us in Slack')).toBe('Every morning')
        expect(fallbackAgentName('Track competitor prices. Report every Monday.')).toBe('Track competitor prices')
    })

    it('keeps the first five words of a sentence with no punctuation', () => {
        expect(fallbackAgentName('find leads in the fintech space and email them')).toBe('find leads in the fintech')
        expect(fallbackAgentName('  sort my inbox  ')).toBe('sort my inbox')
    })

    it('never comes back empty for text made of punctuation', () => {
        expect(fallbackAgentName('?!')).toBe('?!')
    })

    it('stays within the name bound', () => {
        expect(fallbackAgentName('Supercalifragilisticexpialidocious'.repeat(3)).length).toBeLessThanOrEqual(AGENT_NAME_MAX)
    })
})
