const TITLE = /<title[^>]*>([\s\S]*?)<\/title>/i
const MAX_TITLE_LENGTH = 120

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function decodeEntities(text: string): string {
    return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
        if (entity.startsWith('#x') || entity.startsWith('#X')) return String.fromCodePoint(parseInt(entity.slice(2), 16))
        if (entity.startsWith('#')) return String.fromCodePoint(parseInt(entity.slice(1), 10))
        return ENTITIES[entity.toLowerCase()] ?? match
    })
}

export function htmlTitle(html: string): string | null {
    const raw = TITLE.exec(html)?.[1]
    if (!raw) return null
    const title = decodeEntities(raw).replace(/\s+/g, ' ').trim()
    return title ? title.slice(0, MAX_TITLE_LENGTH) : null
}
