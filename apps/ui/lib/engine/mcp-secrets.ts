import { isUuid } from '@rerun/contracts'

// Credential values never belong in an agent's config.json: they go to the engine key store and
// the config keeps only a ${VAR} reference, which the engine substitutes at connect time (see the
// engine's mcp-resolve.ts, which resolves command, args, url, env and headers alike).

const PLACEHOLDER = /\$\{[A-Za-z_][A-Za-z0-9_]*\}/

// A value already carrying a ref points at a stored secret, so it is left whole — including the
// `Bearer ${VAR}` shape the connector compiler emits. Externalizing that would store the ref
// itself as a literal, and the engine resolver only substitutes once.
export function hasRef(value: string): boolean {
    return PLACEHOLDER.test(value)
}

// A stored key name has to be something hasRef matches: a name it cannot match would be
// externalized again on the next save, overwriting the secret with its own ref.
export function sanitize(value: string): string {
    return value
        .replace(/[^A-Za-z0-9_]/g, '_')
        .replace(/^(?=\d)/, '_')
        .toUpperCase()
}

const KNOWN_TOKEN_PREFIX = /^(sk-|sk_live_|sk_test_|pk_live_|rk_live_|ghp_|gho_|ghu_|ghs_|github_pat_|xox[abprs]-|xapp-|glpat-|dop_v1_|shpat_|shpss_|SG\.|AKIA|ASIA|AIza|ya29\.|hf_|nvapi-|pplx-|gsk_|eyJ)/
const NEVER_SECRET_PREFIX = /^(-|\/|\.{1,2}\/|~\/|@[^/\s]+\/|github:|gitlab:|npm:|npx:|pypi:|file:|git\+|uvx?$|bunx?$)/i
const HEX = /^[A-Fa-f0-9]{24,}$/
const TOKEN_CHARSET = /^[A-Za-z0-9_\-.+/=]+$/
// Lowercase words joined by - _ . read as a package or a slug, never as a token. This is the one
// shape the entropy test gets wrong often enough to be worth excluding by hand.
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

// Env and header values can be externalized wholesale, since their key names them. Arguments and
// URL parts cannot: `-y`, `github:owner/repo` and `https://mcp.notion.com/sse` have to stay
// readable. Hence a detector, deliberately biased towards a false positive — externalizing a
// harmless argument stores its exact value and resolves back to it, whereas a missed token stays
// in cleartext for anyone who opens the panel.
export function isSecretLike(value: string): boolean {
    const candidate = value.trim()
    if (candidate.length < 12) return false
    if (/\s/.test(candidate)) return false
    if (candidate.includes('://')) return false
    if (hasRef(candidate)) return false
    if (NEVER_SECRET_PREFIX.test(candidate)) return false
    if (KNOWN_TOKEN_PREFIX.test(candidate)) return true
    if (candidate.length < 16) return false
    if (isUuid(candidate)) return true
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

// Spans are cut out of the original string rather than rebuilt through `new URL()`: rebuilding
// normalizes the trailing slash, the parameter order and the encoding, rewriting a URL the user
// typed by hand.
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

type ServerRefs = { name: string; args: string[]; url?: string; env: Record<string, string>; headers: Record<string, string> }

// Two servers saved together may each carry their own value under one variable: the second one gets
// a key of its own, otherwise both would run with the last value stored.
export function separateKeys<T extends ServerRefs>(server: T, keys: Record<string, string>, taken: Record<string, string>): { server: T; keys: Record<string, string> } {
    const free = (name: string, value: string) => !(name in taken) || taken[name] === value
    const renamed: Record<string, string> = {}
    const separated: Record<string, string> = {}
    for (const [name, value] of Object.entries(keys)) {
        const base = `MCP_${sanitize(server.name)}_${name}`
        let next = name
        for (let suffix = 1; !free(next, value) || (next !== name && next in keys) || next in separated; suffix++) next = suffix === 1 ? base : `${base}_${suffix}`
        if (next !== name) renamed[name] = next
        separated[next] = value
    }
    const swap = (text: string) => text.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (whole, name: string) => (renamed[name] ? ref(renamed[name]) : whole))
    const swapAll = (pairs: Record<string, string>) => Object.fromEntries(Object.entries(pairs).map(([key, value]) => [key, swap(value)]))
    return {
        server: { ...server, args: server.args.map(swap), ...(server.url ? { url: swap(server.url) } : {}), env: swapAll(server.env), headers: swapAll(server.headers) },
        keys: separated,
    }
}

// Both warnings run the real externalizer, so what the field announces is exactly what the save does.
export const argsHaveSecret = (args: string[]) => Object.keys(externalizeArgs(args, 'x').keys).length > 0
export const urlHasSecret = (url: string) => Object.keys(externalizeUrl(url, 'x').keys).length > 0
