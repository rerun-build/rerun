import { describe, expect, it } from 'vitest'
import { injectPreviewMeta } from './meta'

const META = { title: 'Q3 "proposal"', description: 'Published by Ana at Acme', image: 'https://x.rerun.site/__rerun/og.png', url: 'https://x.rerun.site/' }

describe('injectPreviewMeta', () => {
    it('adds the tags before the end of the head, escaped', () => {
        const html = injectPreviewMeta('<html><head><title>x</title></head><body></body></html>', META)
        expect(html).toContain('<meta property="og:title" content="Q3 &quot;proposal&quot;">')
        expect(html).toContain('<meta name="twitter:image" content="https://x.rerun.site/__rerun/og.png"></head>')
    })

    it('keeps a page that sets its own image untouched', () => {
        const page = '<head><meta property="og:image" content="mine.png"></head>'
        expect(injectPreviewMeta(page, META)).toBe(page)
    })

    it('still adds the tags to a fragment with no head', () => {
        expect(injectPreviewMeta('<h1>Hi</h1>', META).startsWith('<meta property="og:type"')).toBe(true)
    })
})
