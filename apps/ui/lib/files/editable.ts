import { TEXT_FILE_PAGE_CHARS } from '@moldwright/contracts'
import { formatNumber } from '@moldwright/i18n/format'

import { filePreviewKind } from './preview'

export type EditBlockReason = 'not-text' | 'truncated' | 'binary'

export function looksBinary(content: string): boolean {
    if (content.includes('\u0000')) return true
    if (content.length === 0) return false
    const replacements = content.match(/\uFFFD/g)?.length ?? 0
    return replacements / content.length > 0.01
}

export function fileEditBlockReason(input: { name: string; truncated: boolean; content: string | null }): EditBlockReason | null {
    if (filePreviewKind(input.name) !== 'text') return 'not-text'
    if (input.truncated) return 'truncated'
    if (input.content !== null && looksBinary(input.content)) return 'binary'
    return null
}

export type EditBlockCopy = (key: 'editNotText' | 'editTruncated' | 'editBinary', values?: { limit: string }) => string

export function editDisabledTooltip(reason: EditBlockReason, locale: string, t: EditBlockCopy): string {
    switch (reason) {
        case 'not-text':
            return t('editNotText')
        case 'truncated':
            return t('editTruncated', { limit: formatNumber(TEXT_FILE_PAGE_CHARS, locale) })
        case 'binary':
            return t('editBinary')
    }
}

export function hashText(content: string): string {
    let hash = 0x811c9dc5
    for (let i = 0; i < content.length; i++) {
        hash ^= content.charCodeAt(i)
        hash = Math.imul(hash, 0x01000193)
    }
    return (hash >>> 0).toString(16)
}

export type Eol = 'lf' | 'crlf'

export function splitEol(content: string): { text: string; eol: Eol } {
    const crlf = content.includes('\r\n')
    return { text: crlf ? content.replace(/\r\n/g, '\n') : content, eol: crlf ? 'crlf' : 'lf' }
}

export function applyEol(text: string, eol: Eol): string {
    return eol === 'crlf' ? text.replace(/\n/g, '\r\n') : text
}
