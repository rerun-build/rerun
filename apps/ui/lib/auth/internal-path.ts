const UNSAFE_CHARACTERS = /[^\x21-\x7e]/
const PLACEHOLDER_ORIGIN = 'http://internal.invalid'

export function internalPath(raw: string | null | undefined, fallback: string): string {
    if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\') || UNSAFE_CHARACTERS.test(raw)) return fallback
    try {
        const parsed = new URL(raw, PLACEHOLDER_ORIGIN)
        return parsed.origin === PLACEHOLDER_ORIGIN && parsed.pathname.startsWith('/') ? raw : fallback
    } catch {
        return fallback
    }
}
