const LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?'
const HOSTNAME = new RegExp(`^(?:${LABEL}\\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$`)
const MAX_HOSTNAME = 253
// A port, a path, credentials, an escape, what the URL parser would drop: something else than a name.
const NOT_A_NAME = /[\s\p{Cc}/\\?#@:%[\]]/u

// A name as DNS and the Host header of a browser spell it. Null for what is not one: the URL parser
// writes every spelling of an address (`0x7f.1`, `2130706433`) the same way, which the last label then
// refuses.
export function normalizeHostname(raw: string): string | null {
    const typed = raw.trim().replace(/\.$/, '')
    if (!typed || NOT_A_NAME.test(typed) || !URL.canParse(`http://${typed}`)) return null
    const { hostname } = new URL(`http://${typed}`)
    return HOSTNAME.test(hostname) && hostname.length <= MAX_HOSTNAME ? hostname : null
}

const RERUN_NAME = /(?:^|\.)rerun\.[a-z]+$/

// Ours (`own`), or looking like it.
export function isReservedHostname(hostname: string, own: (string | null)[]): boolean {
    return RERUN_NAME.test(hostname) || own.some(domain => domain !== null && (hostname === domain || hostname.endsWith(`.${domain}`)))
}
