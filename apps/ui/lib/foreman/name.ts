export const FOREMAN_NAME_MAX = 24

// The name is written into the Chief of Staff's own instructions on every turn, so it is held to
// what a first name or a nickname needs: no quote, bracket or line break a prompt could be broken with.
const NAME_PATTERN = /^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N} .'-]*$/u

export function sanitizeForemanName(raw: unknown): string | null {
    if (typeof raw !== 'string') return null
    const name = raw.normalize('NFC').trim().replace(/ {2,}/g, ' ')
    if (!name || name.length > FOREMAN_NAME_MAX) return null
    return NAME_PATTERN.test(name) ? name : null
}
