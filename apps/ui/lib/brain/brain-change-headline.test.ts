import { brainChangeHeadline, type BrainChange } from '@rerun/contracts'
import { describe, expect, it } from 'vitest'

import { englishTranslator } from '@/lib/i18n/english-translator'

const t = englishTranslator('chat.brainChange.headline')
const change = (patch: Partial<BrainChange>): BrainChange => ({ status: 'saved', slug: 'about', title: 'About', ...patch })

describe('brainChangeHeadline', () => {
    it('reads every change in English as before', () => {
        expect(brainChangeHeadline(change({ mode: 'create' }), t)).toBe('New Brain page: About')
        expect(brainChangeHeadline(change({ mode: 'edit' }), t)).toBe('Brain updated: About')
        expect(brainChangeHeadline(change({ status: 'deleted' }), t)).toBe('Removed from the Brain: About')
        expect(brainChangeHeadline(change({ status: 'accepted', agentName: 'Scout' }), t)).toBe("Accepted Scout's change: About")
        expect(brainChangeHeadline(change({ status: 'accepted' }), t)).toBe('Accepted the change: About')
        expect(brainChangeHeadline(change({ status: 'dismissed', agentName: 'Scout' }), t)).toBe("Dismissed Scout's change: About")
        expect(brainChangeHeadline(change({ status: 'dismissed' }), t)).toBe('Dismissed the change: About')
    })
})
