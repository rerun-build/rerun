export type ByteRange = { start: number; end: number }

export function parseByteRange(header: string | null, size: number): ByteRange | 'unsatisfiable' | null {
    const match = header?.trim().match(/^bytes=(\d*)-(\d*)$/)
    if (!match) return null
    const [, first, last] = match
    if (!first && !last) return null
    if (!first) {
        const suffix = Number(last)
        if (suffix === 0 || size === 0) return 'unsatisfiable'
        return { start: Math.max(0, size - suffix), end: size - 1 }
    }
    const start = Number(first)
    const end = last ? Number(last) : size - 1
    if (last && end < start) return null
    if (start >= size) return 'unsatisfiable'
    return { start, end: Math.min(end, size - 1) }
}
