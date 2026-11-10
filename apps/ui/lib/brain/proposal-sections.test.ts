import type { BrainProposal } from '@rerun/contracts'
import { describe, expect, it } from 'vitest'
import { englishTranslator } from '@/lib/i18n/english-translator'
import { changedOnly, humanAgentName, proposalHeadline, sectionChanges, sectionsOf } from './proposal-sections'

const proposal = (fields: Partial<BrainProposal>) => ({ title: 'Pricing', mode: 'edit', headline: null, ...fields }) as BrainProposal

describe('sectionsOf', () => {
    it('splits a page on its second-level headings and keeps what comes before as the intro', () => {
        expect(sectionsOf('We sell agents.\n\n## Pricing\n- Pro is 49.\n\n## Team\nAna.')).toEqual([
            { heading: null, body: 'We sell agents.' },
            { heading: 'Pricing', body: '- Pro is 49.' },
            { heading: 'Team', body: 'Ana.' },
        ])
    })

    it('ignores the page title and the empty bullets a seed leaves behind', () => {
        expect(sectionsOf('# Offering\n\n## Pricing\n-\n- Pro is 49.\n- ')).toEqual([{ heading: 'Pricing', body: '- Pro is 49.' }])
    })
})

describe('sectionChanges', () => {
    it('tells what was added, changed, removed and left alone', () => {
        const changes = sectionChanges('## Pricing\nNot public.\n\n## Team\nAna.\n\n## Ops\nNotion.', '## Pricing\nPro is 49.\n\n## Team\nAna.\n\n## Support\nIntercom.')
        expect(changes.map(change => [change.heading, change.kind])).toEqual([
            ['Pricing', 'changed'],
            ['Team', 'same'],
            ['Support', 'added'],
            ['Ops', 'removed'],
        ])
        expect(changedOnly(changes).map(change => change.heading)).toEqual(['Pricing', 'Support', 'Ops'])
    })

    it('matches a section whatever the case of its heading, and a title line alone is no change', () => {
        expect(changedOnly(sectionChanges('## pricing\nPro is 49.', '# Offering\n\n## Pricing\nPro is 49.'))).toEqual([])
    })

    it('reads a new page as sections added to nothing', () => {
        expect(sectionChanges(null, 'Cheaper.\n\n## We win\nApprovals.').map(change => [change.heading, change.kind, change.before])).toEqual([
            [null, 'added', ''],
            ['We win', 'added', ''],
        ])
    })
})

describe('proposalHeadline', () => {
    const t = englishTranslator('brain.proposals')
    it('keeps the headline the coworker wrote', () => {
        expect(proposalHeadline(proposal({ headline: 'Pricing is now public' }), t)).toBe('Pricing is now public')
    })

    it('falls back on the page when the proposal has none', () => {
        expect(proposalHeadline(proposal({}), t)).toBe('Update to Pricing')
        expect(proposalHeadline(proposal({ mode: 'create', title: 'Lindy' }), t)).toBe('New page: Lindy')
    })
})

describe('humanAgentName', () => {
    it('reads a handle as a name', () => {
        expect(humanAgentName('buyer_signal_radar')).toBe('Buyer signal radar')
    })
})
