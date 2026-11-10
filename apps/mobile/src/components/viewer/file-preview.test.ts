import { Platform } from 'react-native'

import { filePreviewOf } from '@/components/viewer/file-preview'
import { textPageHtml } from '@/components/viewer/text-page'

const onAndroid = Platform.OS === 'android'

describe('filePreviewOf', () => {
    it('loads web pages in the web view on both platforms', () => {
        expect(filePreviewOf('report.html')).toBe('page')
    })

    it('reads text files as text on Android, where the web view would hand them to the download manager', () => {
        expect(filePreviewOf('fiche-prospection-linear.md')).toBe(onAndroid ? 'text' : 'page')
        expect(filePreviewOf('export.CSV')).toBe(onAndroid ? 'text' : 'page')
    })

    it('sends PDFs and office documents to another app on Android, where the web view draws them blank', () => {
        for (const name of ['Board review Q3.pdf', 'budget.xlsx', 'no-extension']) expect(filePreviewOf(name)).toBe(onAndroid ? 'none' : 'page')
    })
})

describe('textPageHtml', () => {
    it('shows the text as it is, markup included', () => {
        const html = textPageHtml('# Title\n<b>a & b</b>')
        expect(html).toContain('<pre')
        expect(html).toContain('# Title\n&lt;b&gt;a &amp; b&lt;/b&gt;')
    })
})
