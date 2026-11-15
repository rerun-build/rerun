import { createHash } from 'node:crypto'

export type Chunk = { heading: string; ordinal: number; content: string; text: string; textHash: string }

export const MAX_CHUNK_CHARS = 1500
export const MIN_CHUNK_CHARS = 200

export type Section = { heading: string; body: string }

const HEADING = /^#{2,3}\s+(.+?)\s*#*\s*$/

export function pageSections(content: string): Section[] {
    const out: Section[] = []
    let current: Section = { heading: 'Overview', body: '' }
    for (const line of content.split('\n')) {
        const match = HEADING.exec(line)
        if (match) {
            out.push(current)
            current = { heading: match[1], body: '' }
        } else {
            current.body += `${line}\n`
        }
    }
    out.push(current)
    return out.map(s => ({ heading: s.heading, body: s.body.trim() })).filter(s => s.body.length > 0)
}

function splitLong(body: string): string[] {
    if (body.length <= MAX_CHUNK_CHARS) return [body]
    const parts: string[] = []
    let buffer = ''
    for (const paragraph of body.split(/\n{2,}/)) {
        if (buffer && buffer.length + paragraph.length + 2 > MAX_CHUNK_CHARS) {
            parts.push(buffer)
            buffer = ''
        }
        buffer = buffer ? `${buffer}\n\n${paragraph}` : paragraph
        while (buffer.length > MAX_CHUNK_CHARS) {
            const window = buffer.slice(0, MAX_CHUNK_CHARS)
            const cut = Math.max(window.lastIndexOf('\n'), window.lastIndexOf(' '))
            const at = cut > MAX_CHUNK_CHARS / 2 ? cut : MAX_CHUNK_CHARS
            parts.push(buffer.slice(0, at).trim())
            buffer = buffer.slice(at).trim()
        }
    }
    if (buffer) parts.push(buffer)
    return parts
}

function mergeShort(list: Section[]): Section[] {
    const out: Section[] = []
    let pending: Section | null = null
    for (const section of list) {
        const merged: Section = pending ? { heading: `${pending.heading} / ${section.heading}`, body: `${pending.body}\n\n${section.body}` } : section
        pending = null
        if (merged.body.length < MIN_CHUNK_CHARS) pending = merged
        else out.push(merged)
    }
    if (pending) {
        const last = out.pop()
        out.push(last ? { heading: `${last.heading} / ${pending.heading}`, body: `${last.body}\n\n${pending.body}` } : pending)
    }
    return out
}

export const chunkText = (title: string, type: string, heading: string, content: string) => `${title} (${type}) > ${heading}\n\n${content}`

export const textHash = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 32)

export function chunkPage(page: { title: string; type: string; content: string }): Chunk[] {
    const chunks: Chunk[] = []
    for (const section of mergeShort(pageSections(page.content))) {
        for (const content of splitLong(section.body)) {
            const text = chunkText(page.title, page.type, section.heading, content)
            chunks.push({ heading: section.heading, ordinal: chunks.length, content, text, textHash: textHash(text) })
        }
    }
    return chunks
}
