import { describe, expect, it } from 'vitest'
import { preferredLanguage } from './language'

describe('preferredLanguage', () => {
    it('names the first language of the header in English, ignoring the region and the weight', () => {
        expect(preferredLanguage('fr-FR,fr;q=0.9,en;q=0.8')).toBe('French')
        expect(preferredLanguage(' de;q=0.7 , en')).toBe('German')
    })

    it('names Chinese with the script of its pack, and a language without a pack all the same', () => {
        expect(preferredLanguage('zh-TW,zh;q=0.9')).toBe('Traditional Chinese (Taiwan)')
        expect(preferredLanguage('zh-HK')).toBe('Traditional Chinese (Taiwan)')
        expect(preferredLanguage('zh-CN')).toBe('Simplified Chinese')
        expect(preferredLanguage('it-IT')).toBe('Italian')
    })

    it('skips empty entries', () => {
        expect(preferredLanguage(', ,es')).toBe('Spanish')
    })

    it('has no guess without a header or with a malformed tag', () => {
        expect(preferredLanguage(null)).toBeNull()
        expect(preferredLanguage(undefined)).toBeNull()
        expect(preferredLanguage('')).toBeNull()
        expect(preferredLanguage('!!')).toBeNull()
    })
})
