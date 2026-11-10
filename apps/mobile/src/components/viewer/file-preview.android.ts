import type { FilePreview } from '@/components/viewer/file-preview'

export type { FilePreview } from '@/components/viewer/file-preview'

// Android's web view draws web pages, but hands any other file it is given by address to the download
// manager, which refuses a local file: a text file is read and shown as text, a PDF or an office
// document goes to another app.
const PAGES = new Set(['html', 'htm', 'svg'])
const TEXTS = new Set(['txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'log', 'xml', 'yaml', 'yml', 'css', 'js', 'ts', 'py', 'sh'])

export function filePreviewOf(name: string): FilePreview {
    const extension = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : ''
    if (PAGES.has(extension)) return 'page'
    if (TEXTS.has(extension)) return 'text'
    return 'none'
}
