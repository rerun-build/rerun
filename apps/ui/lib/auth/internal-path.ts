// Browsers drop tab, newline and carriage return from a URL before parsing it, so `/\t/evil.com`
// would be read as `//evil.com`: anything outside the printable range is refused with the rest.
const UNSAFE_CHARACTERS = /[^\x21-\x7e]/
const PLACEHOLDER_ORIGIN = 'http://internal.invalid'

// A destination the app may send the browser to after a sign-in: a path of this host, never another
// origin, never a scheme. Anything else falls back.
export function internalPath(raw: string | null | undefined, fallback: string): string {
    if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\') || UNSAFE_CHARACTERS.test(raw)) return fallback
    try {
        const parsed = new URL(raw, PLACEHOLDER_ORIGIN)
        return parsed.origin === PLACEHOLDER_ORIGIN && parsed.pathname.startsWith('/') ? raw : fallback
    } catch {
        return fallback
    }
}
