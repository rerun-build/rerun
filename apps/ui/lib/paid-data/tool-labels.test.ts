import { PAID_DATA_CAPABILITIES, toolActivityOf } from '@rerun/contracts'
import { describe, expect, it } from 'vitest'

import { englishTranslator } from '@/lib/i18n/english-translator'
import { getToolMeta } from '@/lib/tool-meta'
import { paidDataIcon } from './spend'

const t = englishTranslator('tools')

describe('a paid_data call in the chat', () => {
    it('is labelled after the capability it bought', () => {
        expect(getToolMeta('paid_data', { capability: 'tiktok.user.profile', params: { username: 'khaby.lame' } }, t)).toEqual({ label: 'Reading TikTok', icon: paidDataIcon('tiktok.user.profile') })
    })

    it('reads as what the coworker is doing', () => {
        expect(toolActivityOf('paid_data', { capability: 'tiktok.user.profile', params: { username: 'khaby.lame' } }, t)).toBe('Reading TikTok')
        expect(toolActivityOf('paid_data', { capability: 'ai-search.perplexity.answer', params: {} }, t)).toBe('Asking Perplexity')
        expect(toolActivityOf('paid_data', { capability: 'people.email.find', params: {} }, t)).toBe('Finding emails')
    })

    it('has a line in the catalog for every capability', () => {
        expect(PAID_DATA_CAPABILITIES.filter(capability => !t.has(`paidData.${capability}`))).toEqual([])
    })
})
