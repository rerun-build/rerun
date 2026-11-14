import { BRAIN_SLUG_RE } from '@rerun/contracts'

const WIKILINK = /\[\[([^\]|#\n]+)(?:#[^\]|\n]*)?(?:\|[^\]\n]*)?\]\]/g

export function parseLinks(content: string, self?: string): string[] {
    const found = new Set<string>()
    for (const match of content.matchAll(WIKILINK)) {
        const target = match[1].trim().toLowerCase()
        if (target !== self && BRAIN_SLUG_RE.test(target)) found.add(target)
    }
    return [...found]
}
