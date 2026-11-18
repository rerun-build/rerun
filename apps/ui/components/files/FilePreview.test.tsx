import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FilePreview } from './FilePreview'

function preview(fileName: string, content: string): string {
    return renderToStaticMarkup(createElement(FilePreview, { fileName, content, rawUrl: '/raw', loading: false }))
}

describe('FilePreview', () => {
    it('renders an HTML report as a page in a sandbox where no script runs', () => {
        const html = '<!doctype html><html><body><h1>Rapport été</h1><script>parent.document.body.remove()</script></body></html>'
        const markup = preview('report.html', html)

        expect(markup).not.toContain('<pre')
        const sandbox = /<iframe[^>]*sandbox="([^"]*)"/.exec(markup)?.[1]
        expect(sandbox?.split(' ').sort()).toEqual(['allow-popups', 'allow-popups-to-escape-sandbox'])
        expect(markup).toContain('&lt;base href=&quot;about:srcdoc&quot; target=&quot;_blank&quot;&gt;&lt;!doctype html&gt;')
    })

    it('leaves the frontmatter of a Markdown file out of the page', () => {
        const markup = preview('post.md', '---\ntitle: Weekly report\ndate: 2026-11-18\n---\n\n# Report\n')

        expect(markup).toContain('<h1>Report</h1>')
        expect(markup).not.toContain('title:')
        expect(markup).not.toContain('<hr')
    })

    it('renders a Markdown report with its headings, bold text and tables', () => {
        const markdown = '# Rapport\n\n**Résumé** : trois clients.\n\n| Client | Statut |\n| --- | --- |\n| SG | Signé |\n'
        const markup = preview('report.md', markdown)

        expect(markup).toContain('<h1>Rapport</h1>')
        expect(markup).toContain('<strong>Résumé</strong>')
        expect(markup).toContain('<table>')
        expect(markup).not.toContain('# Rapport')
    })

    it('keeps any other text file as plain source', () => {
        expect(preview('notes.txt', '# not a heading')).toContain('<pre')
    })
})
