import { TEXT_FILE_PAGE_CHARS } from '@rerun/contracts'
import { formatNumber } from '@rerun/i18n/format'

import { filePreviewKind } from './preview'

export type EditBlockReason = 'not-text' | 'truncated' | 'binary'

// Pure and isomorphic on purpose: the client greys out the Edit button with these rules and the
// server refuses the write with the same ones, so a hand-made request cannot do what the UI won't.

// `filePreviewKind` falls back to 'text' for anything it does not recognise, so a .pyc or an
// extensionless binary reaches the editor. Reading one is harmless; saving one destroys it, because
// the engine read it as utf8 and every invalid byte already came back as U+FFFD.
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

// The `files.detail` catalog.
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

// Enough to tell "the file changed under me" from "it did not", on a payload both sides already
// hold. A real digest would mean pulling in crypto on both sides for the same answer.
export function hashText(content: string): string {
    let hash = 0x811c9dc5
    for (let i = 0; i < content.length; i++) {
        hash ^= content.charCodeAt(i)
        hash = Math.imul(hash, 0x01000193)
    }
    return (hash >>> 0).toString(16)
}

export type Eol = 'lf' | 'crlf'

// A textarea and CodeMirror both hand back '\n' whatever went in, so a Windows file saved as-is
// would come back with every one of its lines rewritten.
export function splitEol(content: string): { text: string; eol: Eol } {
    const crlf = content.includes('\r\n')
    return { text: crlf ? content.replace(/\r\n/g, '\n') : content, eol: crlf ? 'crlf' : 'lf' }
}

export function applyEol(text: string, eol: Eol): string {
    return eol === 'crlf' ? text.replace(/\n/g, '\r\n') : text
}
