export type PreviewMeta = { title: string; description: string; image: string; url: string }

function escapeAttribute(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// A page the coworker wrote rarely says how it should unfurl. When it names no image of its own, it
// gets the Rerun card; a page that sets its own og:image keeps every tag it wrote.
export function injectPreviewMeta(html: string, meta: PreviewMeta): string {
    if (/<meta[^>]+property=["']og:image["']/i.test(html)) return html
    const tags = [
        ['og:type', 'website'],
        ['og:title', meta.title],
        ['og:description', meta.description],
        ['og:image', meta.image],
        ['og:url', meta.url],
    ]
        .map(([property, content]) => `<meta property="${property}" content="${escapeAttribute(content)}">`)
        .concat(['<meta name="twitter:card" content="summary_large_image">', `<meta name="twitter:image" content="${escapeAttribute(meta.image)}">`])
        .join('')

    const headEnd = html.toLowerCase().indexOf('</head>')
    if (headEnd !== -1) return html.slice(0, headEnd) + tags + html.slice(headEnd)
    const headStart = /<head[^>]*>/i.exec(html)
    if (headStart) return html.slice(0, headStart.index + headStart[0].length) + tags + html.slice(headStart.index + headStart[0].length)
    return tags + html
}
