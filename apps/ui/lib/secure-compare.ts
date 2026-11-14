import { timingSafeEqual } from 'node:crypto'

export function secretMatches(value: string | null, expected: string): boolean {
    const a = Buffer.from(value ?? '')
    const b = Buffer.from(expected)
    return b.length > 0 && a.length === b.length && timingSafeEqual(a, b)
}

export function bearerTokenMatches(header: string | null, expected: string): boolean {
    return secretMatches(header?.startsWith('Bearer ') ? header.slice(7) : '', expected)
}
