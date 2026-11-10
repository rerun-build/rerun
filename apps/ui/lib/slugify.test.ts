import { describe, expect, it } from 'vitest'

import { slugify } from './slugify'

describe('slugify', () => {
    it('strips diacritics and punctuation into kebab-case', () => {
        expect(slugify('Café Richard & Co.')).toBe('cafe-richard-co')
        expect(slugify('  --  ')).toBe('')
    })

    it('cuts at maxLength without leaving a trailing dash', () => {
        expect(slugify('a'.repeat(80), { maxLength: 64 }).length).toBe(64)
        expect(slugify(`${'a'.repeat(63)} b`, { maxLength: 64 })).toBe('a'.repeat(63))
    })
})
