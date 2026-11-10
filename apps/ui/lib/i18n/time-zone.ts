// The browser writes its time zone here, so a date the server formats reads the same once the
// client hydrates it.
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
