// Android's web view draws text and web pages only: a PDF or an office document stays a blank page.
const DRAWN = new Set(['txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'log', 'xml', 'html', 'htm', 'svg', 'yaml', 'yml', 'css', 'js', 'ts', 'py', 'sh'])

export function webViewPreviews(name: string): boolean {
    const extension = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : ''
    return DRAWN.has(extension)
}
