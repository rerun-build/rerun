export const TIME_ZONE_COOKIE = 'rerun-tz'

export function validTimeZone(value: string | null | undefined): string | undefined {
    if (!value) return undefined
    try {
        new Intl.DateTimeFormat('en', { timeZone: value })
        return value
    } catch {
        return undefined
    }
}
