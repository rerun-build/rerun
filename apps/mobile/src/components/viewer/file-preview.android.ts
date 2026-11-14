import type { FilePreview } from '@/components/viewer/file-preview'

export type { FilePreview } from '@/components/viewer/file-preview'

const PAGES = new Set(['html', 'htm', 'svg'])
const TEXTS = new Set(['txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'log', 'xml', 'yaml', 'yml', 'css', 'js', 'ts', 'py', 'sh'])

export function filePreviewOf(name: string): FilePreview {
    const extension = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : ''
    if (PAGES.has(extension)) return 'page'
    if (TEXTS.has(extension)) return 'text'
    return 'none'
}
