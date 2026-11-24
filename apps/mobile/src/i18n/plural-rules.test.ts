import { installPluralRules, PackPluralRules } from '@/i18n/plural-rules'

describe('PackPluralRules', () => {
    it('follows the CLDR cardinal rules of the packs', () => {
        expect([0, 1, 2].map(n => new PackPluralRules('en').select(n))).toEqual(['other', 'one', 'other'])
        expect([0, 1, 1.5, 2, 1_000_000].map(n => new PackPluralRules('fr-FR').select(n))).toEqual(['one', 'one', 'one', 'other', 'many'])
        expect([0, 1, 2, 2_000_000].map(n => new PackPluralRules('es').select(n))).toEqual(['other', 'one', 'other', 'many'])
        expect([0, 1, 1.5, 2, 1_000_000].map(n => new PackPluralRules('pt-BR').select(n))).toEqual(['one', 'one', 'one', 'other', 'many'])
        expect([0, 1, 1.5, 2].map(n => new PackPluralRules('de').select(n))).toEqual(['other', 'one', 'other', 'other'])
        expect([0, 1, 1.5, 2].map(n => new PackPluralRules('tr-TR').select(n))).toEqual(['other', 'one', 'other', 'other'])
    })

    it('gives Arabic, Hebrew and Chinese the categories of the platform', () => {
        const numbers = [0, 1, 2, 3, 10, 11, 99, 100, 101, 102, 103, 111, 1000, 1.5, 0.5]
        for (const locale of ['ar', 'he', 'zh']) {
            const native = new Intl.PluralRules(locale)
            const pack = new PackPluralRules(locale)
            expect(numbers.map(n => pack.select(n))).toEqual(numbers.map(n => native.select(n)))
            expect([...pack.resolvedOptions().pluralCategories].sort()).toEqual([...native.resolvedOptions().pluralCategories].sort())
        }
    })

    it('stands in for a missing Intl.PluralRules, and only then', () => {
        const bare: { PluralRules?: unknown } = {}
        installPluralRules(bare)
        expect(bare.PluralRules).toBe(PackPluralRules)

        const native = { PluralRules: Intl.PluralRules }
        installPluralRules(native)
        expect(native.PluralRules).toBe(Intl.PluralRules)
    })

    it('lets a plural message format where Hermes has no Intl.PluralRules', () => {
        const { createTranslator } = jest.requireActual<typeof import('use-intl')>('use-intl')
        const native = Intl.PluralRules
        try {
            Reflect.deleteProperty(Intl, 'PluralRules')
            installPluralRules()
            const t = createTranslator({ locale: 'fr', messages: { files: '{count, plural, one {# fichier} other {# fichiers}}' } })
            expect(t('files', { count: 0 })).toBe('0 fichier')
            expect(t('files', { count: 3 })).toBe('3 fichiers')
        } finally {
            Object.defineProperty(Intl, 'PluralRules', { value: native, configurable: true, writable: true })
        }
    })
})
