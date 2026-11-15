const URL_PARTS = /^[a-z][a-z\d+.-]*:\/\/(?:[^@/?#]*@)?([^/?#:]+)(?::\d+)?([^?#]*)(\?[^#]*)?(#.*)?$/i
const ELLIPSIS = '…'
const NON_BREAKING_HYPHEN = '‑'
const WORD_JOINER = '⁠'
const LAST_SEGMENT_MAX = 24

export function shortenUrl(url: string): string {
    const parts = url.match(URL_PARTS)
    if (!parts) return url
    const [, hostname, pathname, search, hash] = parts
    const host = hostname.toLowerCase().replace(/^www\./, '')
    const segments = pathname.split('/').filter(Boolean)
    const last = segments.at(-1)
    const tail = last && last.length > LAST_SEGMENT_MAX ? `${last.slice(0, LAST_SEGMENT_MAX / 2)}${ELLIPSIS}${WORD_JOINER}${last.slice(1 - LAST_SEGMENT_MAX / 2)}` : last
    let label = host
    if (segments.length === 1) label = `${host}/${tail}`
    else if (segments.length > 1) label = `${host}/${ELLIPSIS}/${tail}`
    if (((search && search.length > 1) || (hash && hash.length > 1)) && !label.endsWith(ELLIPSIS)) label = `${label}${ELLIPSIS}`
    return label.replaceAll('-', NON_BREAKING_HYPHEN)
}
