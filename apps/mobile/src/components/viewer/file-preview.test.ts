import { Platform } from 'react-native'

import { webViewPreviews } from '@/components/viewer/file-preview'

describe('webViewPreviews', () => {
    it('previews text in the web view on both platforms', () => {
        expect(webViewPreviews('fiche-prospection-linear.md')).toBe(true)
        expect(webViewPreviews('export.CSV')).toBe(true)
    })

    it('leaves PDFs and office documents to another app on Android, where the web view draws them blank', () => {
        const expected = Platform.OS !== 'android'
        expect(webViewPreviews('Board review Q3.pdf')).toBe(expected)
        expect(webViewPreviews('budget.xlsx')).toBe(expected)
        expect(webViewPreviews('no-extension')).toBe(expected)
    })
})
