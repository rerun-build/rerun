const PLACEHOLDER = /\$\{[A-Za-z_][A-Za-z0-9_]*\}/

export function hasRef(value: string): boolean {
    return PLACEHOLDER.test(value)
}

export function sanitize(value: string): string {
    return value
        .replace(/[^A-Za-z0-9_]/g, '_')
        .replace(/^(?=\d)/, '_')
        .toUpperCase()
}

const KNOWN_TOKEN_PREFIX = /^(sk-|sk_live_|sk_test_|pk_live_|rk_live_|ghp_|gho_|ghu_|ghs_|github_pat_|xox[abprs]-|xapp-|glpat-|dop_v1_|shpat_|shpss_|SG\.|AKIA|ASIA|AIza|ya29\.|hf_|nvapi-|pplx-|gsk_|eyJ)/
const NEVER_SECRET_PREFIX = /^(-|\/|\.{1,2}\/|~\/|@[^/\s]+\/|github:|gitlab:|npm:|npx:|pypi:|file:|git\+|uvx?$|bunx?$)/i
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const HEX = /^[A-Fa-f0-9]{24,}$/
const TOKEN_CHARSET = /^[A-Za-z0-9_\-.+/=]+$/
const READABLE_SLUG = /^[a-z0-9]+([-_.][a-z0-9]+)+$/

function shannonEntropy(value: string): number {
    const counts = new Map<string, number>()
    for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1)
    let bits = 0
    for (const count of counts.values()) {
        const p = count / value.length
        bits -= p * Math.log2(p)
    }
    return bits
}

function characterClasses(value: string): number {
    return Number(/[a-z]/.test(value)) + Number(/[A-Z]/.test(value)) + Number(/[0-9]/.test(value))
}

export function isSecretLike(value: string): boolean {
    const candidate = value.trim()
    if (candidate.length < 12) return false
    if (/\s/.test(candidate)) return false
    if (candidate.includes('://')) return false
    if (hasRef(candidate)) return false
    if (NEVER_SECRET_PREFIX.test(candidate)) return false
    if (KNOWN_TOKEN_PREFIX.test(candidate)) return true
    if (candidate.length < 16) return false
    if (UUID.test(candidate)) return true
    if (HEX.test(candidate)) return true
    if (candidate.length < 24) return false
    if (!TOKEN_CHARSET.test(candidate)) return false
    if (READABLE_SLUG.test(candidate)) return false
    return characterClasses(candidate) >= 2 && shannonEntropy(candidate) >= 3.5
}

type Namer = (base: string) => string

function createNamer(): Namer {
    const used = new Set<string>()
    return base => {
        let name = base
        let suffix = 2
        while (used.has(name)) name = `${base}_${suffix++}`
        used.add(name)
        return name
    }
}

const ref = (name: string) => `\${${name}}`

export type Externalized<T> = { value: T; keys: Record<string, string> }

export function externalizePairs(pairs: Record<string, string>, prefix = ''): Externalized<Record<string, string>> {
    const value: Record<string, string> = {}
    const keys: Record<string, string> = {}
    for (const [pairKey, pairValue] of Object.entries(pairs)) {
        if (hasRef(pairValue)) {
            value[pairKey] = pairValue
            continue
        }
        const name = `${prefix}${sanitize(pairKey)}`
        keys[name] = pairValue
        value[pairKey] = ref(name)
    }
    return { value, keys }
}

const SENSITIVE_PARAM = /(token|key|secret|auth|pass|sig|signature|credential)/i

type Span = { start: number; end: number; hint: string }

function secretSpans(url: string): Span[] {
    const spans: Span[] = []
    const schemeEnd = url.indexOf('://')
    const authorityStart = schemeEnd === -1 ? 0 : schemeEnd + 3
    const authorityEnd = (() => {
        const candidates = ['/', '?', '#'].map(char => url.indexOf(char, authorityStart)).filter(index => index !== -1)
        return candidates.length > 0 ? Math.min(...candidates) : url.length
    })()

    const authority = url.slice(authorityStart, authorityEnd)
    const at = authority.lastIndexOf('@')
    if (at > 0) {
        const colon = authority.slice(0, at).indexOf(':')
        const password = colon === -1 ? '' : authority.slice(colon + 1, at)
        if (password && !hasRef(password)) spans.push({ start: authorityStart + colon + 1, end: authorityStart + at, hint: 'PASSWORD' })
    }

    const hash = url.indexOf('#', authorityEnd)
    const tail = hash === -1 ? url.length : hash
    const queryStart = url.indexOf('?', authorityEnd)
    const pathEnd = queryStart === -1 || queryStart > tail ? tail : queryStart

    let pathOffset = 0
    url.slice(authorityEnd, pathEnd)
        .split('/')
        .forEach((segment, index) => {
            const start = authorityEnd + pathOffset
            pathOffset += segment.length + 1
            if (isSecretLike(segment)) spans.push({ start, end: start + segment.length, hint: `PATH${index}` })
        })

    if (queryStart !== -1 && queryStart < tail) {
        let queryOffset = 0
        for (const pair of url.slice(queryStart + 1, tail).split('&')) {
            const start = queryStart + 1 + queryOffset
            queryOffset += pair.length + 1
            const equals = pair.indexOf('=')
            if (equals <= 0) continue
            const paramName = pair.slice(0, equals)
            const paramValue = pair.slice(equals + 1)
            if (!paramValue || hasRef(paramValue)) continue
            if (!SENSITIVE_PARAM.test(paramName) && !isSecretLike(paramValue)) continue
            spans.push({ start: start + equals + 1, end: start + pair.length, hint: sanitize(paramName) })
        }
    }

    return spans
}

function externalizeUrlWith(url: string, serverName: string, namer: Namer): Externalized<string> {
    const keys: Record<string, string> = {}
    let out = url
    for (const span of secretSpans(url).sort((a, b) => b.start - a.start)) {
        const name = namer(`MCP_${sanitize(serverName)}_${span.hint}`)
        keys[name] = url.slice(span.start, span.end)
        out = `${out.slice(0, span.start)}${ref(name)}${out.slice(span.end)}`
    }
    return { value: out, keys }
}

export function externalizeUrl(url: string, serverName: string): Externalized<string> {
    return externalizeUrlWith(url, serverName, createNamer())
}

const flagHint = (arg: string) => sanitize(arg.replace(/^-+/, '').split('=')[0])
const INLINE_FLAG = /^(--?[A-Za-z0-9][^\s=]*)=(.+)$/

export function externalizeArgs(args: string[], serverName: string): Externalized<string[]> {
    const namer = createNamer()
    const keys: Record<string, string> = {}
    const take = (secret: string, hint: string) => {
        const name = namer(`MCP_${sanitize(serverName)}_${hint}`)
        keys[name] = secret
        return ref(name)
    }
    const value = args.map((arg, index) => {
        if (arg.includes('://')) {
            const resolved = externalizeUrlWith(arg, serverName, namer)
            Object.assign(keys, resolved.keys)
            return resolved.value
        }
        const inline = INLINE_FLAG.exec(arg)
        if (inline) {
            const [, flag, inlineValue] = inline
            return isSecretLike(inlineValue) ? `${flag}=${take(inlineValue, flagHint(flag) || `ARG${index}`)}` : arg
        }
        if (!isSecretLike(arg)) return arg
        const previous = args[index - 1] ?? ''
        const hint = previous.startsWith('-') && flagHint(previous) ? flagHint(previous) : `ARG${index}`
        return take(arg, hint)
    })
    return { value, keys }
}

export const argsHaveSecret = (args: string[]) => Object.keys(externalizeArgs(args, 'x').keys).length > 0
export const urlHasSecret = (url: string) => Object.keys(externalizeUrl(url, 'x').keys).length > 0
