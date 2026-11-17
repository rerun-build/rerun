// Shared by `pnpm i18n:check` and `pnpm i18n:translate`: reads the packs of packages/i18n, flattens
// them to dotted keys, and checks a translated string against its English source.
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export const ROOT = path.resolve(import.meta.dirname, '../..')
export const PACKAGE_DIR = path.join(ROOT, 'packages/i18n')
export const MESSAGES_DIR = path.join(PACKAGE_DIR, 'messages')
export const LOCK_FILE = path.join(MESSAGES_DIR, '.i18n-lock.json')
export const SOURCE_LOCALE = 'en'
export const CONTEXT_KEY = '_context'

export function supportedLocales() {
    const source = readFileSync(path.join(PACKAGE_DIR, 'src/locales.ts'), 'utf8')
    const block = source.match(/SUPPORTED_LOCALES = \{([\s\S]*?)\}/)?.[1] ?? ''
    return [...block.matchAll(/^\s*'?([a-z]{2})'?:\s*'(stable|beta)'/gm)].map(([, locale, status]) => ({ locale, status }))
}

export function targetLocales() {
    return supportedLocales()
        .map(entry => entry.locale)
        .filter(locale => locale !== SOURCE_LOCALE)
}

export function namespaces(locale = SOURCE_LOCALE) {
    const dir = path.join(MESSAGES_DIR, locale)
    if (!existsSync(dir)) return []
    return readdirSync(dir)
        .filter(file => file.endsWith('.json'))
        .map(file => file.slice(0, -'.json'.length))
        .sort()
}

export function readNamespace(locale, ns) {
    const file = path.join(MESSAGES_DIR, locale, `${ns}.json`)
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}
}

export function writeNamespace(locale, ns, tree) {
    writeFileSync(path.join(MESSAGES_DIR, locale, `${ns}.json`), `${JSON.stringify(tree, null, 4)}\n`)
}

export function flatten(tree, prefix = '') {
    const out = {}
    for (const [key, value] of Object.entries(tree)) {
        if (key === CONTEXT_KEY) continue
        const dotted = prefix ? `${prefix}.${key}` : key
        if (value && typeof value === 'object') Object.assign(out, flatten(value, dotted))
        else out[dotted] = String(value)
    }
    return out
}

// Rebuilt in the order of the English source, so a pack's diff lines up with the source's.
export function unflattenLike(source, flat, prefix = '') {
    const out = {}
    for (const [key, value] of Object.entries(source)) {
        if (key === CONTEXT_KEY) continue
        const dotted = prefix ? `${prefix}.${key}` : key
        if (value && typeof value === 'object') {
            const child = unflattenLike(value, flat, dotted)
            if (Object.keys(child).length) out[key] = child
        } else if (flat[dotted] !== undefined) {
            out[key] = flat[dotted]
        }
    }
    return out
}

export function contextOf(tree) {
    return tree[CONTEXT_KEY] && typeof tree[CONTEXT_KEY] === 'object' ? tree[CONTEXT_KEY] : {}
}

export function hashOf(text) {
    return createHash('sha256').update(text).digest('hex').slice(0, 12)
}

export function readLock() {
    return existsSync(LOCK_FILE) ? JSON.parse(readFileSync(LOCK_FILE, 'utf8')) : {}
}

export function writeLock(lock) {
    const sorted = Object.fromEntries(Object.keys(lock).sort().map(locale => [locale, Object.fromEntries(Object.entries(lock[locale]).sort(([a], [b]) => a.localeCompare(b)))]))
    writeFileSync(LOCK_FILE, `${JSON.stringify(sorted, null, 4)}\n`)
}

export function readGlossary() {
    return JSON.parse(readFileSync(path.join(PACKAGE_DIR, 'glossary.json'), 'utf8'))
}

// `{name}`, `{count, plural, ...}` and `{when, date}` as "name", "count:plural", "when:date", and the
// rich text tags as "<link>": what a translation must carry over unchanged. A small walk over the ICU
// syntax, so the text of a branch (`=0 {coworkers}`) is never taken for an argument.
export function placeholdersOf(message) {
    const found = new Set()
    const walkText = index => {
        while (index < message.length) {
            const char = message[index]
            if (char === '}') return index
            if (char === '{') {
                index = walkArgument(index)
                continue
            }
            index += 1
        }
        return index
    }
    const walkArgument = start => {
        let index = start + 1
        let head = ''
        while (index < message.length && message[index] !== '}' && message[index] !== '{') head += message[index++]
        const [name, type] = head.split(',').map(part => part.trim())
        if (name) found.add(type ? `${name}:${type}` : name)
        while (index < message.length && message[index] !== '}') {
            if (message[index] === '{') {
                index = walkText(index + 1) + 1
                continue
            }
            index += 1
        }
        return index + 1
    }
    walkText(0)
    for (const [, name] of message.matchAll(/<\/?([A-Za-z0-9_]+)>/g)) found.add(`<${name}>`)
    return [...found].sort()
}

const DASHES = /[—–]/

export function problemsOf({ key, source, translation, locale, glossary }) {
    const problems = []
    if (typeof translation !== 'string' || !translation.trim()) return [`${key}: empty`]
    // Same arguments with the same types, except that a language may need a plural or a select on an
    // argument English uses as is ("{failed} failed" becomes "{failed, plural, ...} en échec").
    const loose = placeholder => placeholder.replace(/:(plural|select|selectordinal)$/, '')
    const sourcePlaceholders = placeholdersOf(source)
    const translationPlaceholders = placeholdersOf(translation).map(placeholder => (sourcePlaceholders.includes(placeholder) ? placeholder : sourcePlaceholders.includes(loose(placeholder)) ? loose(placeholder) : placeholder))
    const expected = sourcePlaceholders.join(' ')
    const actual = [...new Set(translationPlaceholders)].sort().join(' ')
    if (expected !== actual) problems.push(`${key}: placeholders differ (source: ${expected || 'none'}, ${locale}: ${actual || 'none'})`)
    if (/\b(plural|select|selectordinal)\b/.test(source) && !/\bother\s*\{/.test(translation)) problems.push(`${key}: plural or select without an "other" branch`)
    if (DASHES.test(translation)) problems.push(`${key}: contains an em or en dash`)
    const lengthProblem = metaLengthProblem(key, translation)
    if (lengthProblem) problems.push(lengthProblem)
    for (const term of glossary.keep ?? []) {
        if (new RegExp(`\\b${term}\\b`).test(source) && !translation.includes(term)) problems.push(`${key}: "${term}" must stay as written`)
    }
    return problems
}

// The keys that become a page's <title> on rerun.build. In English they are written in headline case,
// as the home page always was; the other languages keep the sentence case of their own usage.
const PAGE_TITLE_KEYS = [
    /^landing[A-Za-z]+\.(.+\.)?metaTitle$/,
    /^landing(Industries|Compare)\.hub\.title$/,
    /^landingPricing\.(lifetime\.)?seo\.title$/,
    /^landingDownload\.title$/,
    /^landing(Community|Resources)\.metadata\.(.+\.)?title$/,
    /^landingCommon\.site\.title$/,
]

export function isPageTitleKey(id) {
    return PAGE_TITLE_KEYS.some(pattern => pattern.test(id))
}

const META_DESCRIPTION_KEYS = [
    /^landing[A-Za-z]+\.(.+\.)?metaDescription$/,
    /^landing(Features|Industries|Compare)\.hub\.description$/,
    /^landingPricing\.(lifetime\.)?seo\.description$/,
    /^landingDownload\.description$/,
    /^landing(Community|Resources)\.metadata\.(.+\.)?description$/,
    /^landingCommon\.site\.description$/,
]

// Google cuts a result title around 60 characters and a snippet around 155 (SEO_DESCRIPTION_MAX_LENGTH
// of @rerun/contracts): past that, a language reads with an ellipsis where English does not.
const PAGE_TITLE_MAX_LENGTH = 60
const META_DESCRIPTION_MAX_LENGTH = 155

function metaLimitOf(id) {
    if (isPageTitleKey(id)) return { what: 'page title', max: PAGE_TITLE_MAX_LENGTH }
    if (META_DESCRIPTION_KEYS.some(pattern => pattern.test(id))) return { what: 'meta description', max: META_DESCRIPTION_MAX_LENGTH }
    return null
}

// An argument counts as the few characters its value takes on the page ({price} is "$29").
export function renderedLength(message) {
    return message.replace(/\{[^{}]*\}/g, 'XXXX').length
}

export function metaLengthProblem(id, message) {
    const limit = metaLimitOf(id)
    if (!limit || renderedLength(message) <= limit.max) return null
    return `${id}: ${renderedLength(message)} characters, a ${limit.what} takes ${limit.max} at most`
}

export function metaLengthNote(id) {
    const limit = metaLimitOf(id)
    return limit ? `Shown in search results: ${limit.max} characters at most, arguments counted as 4.` : null
}

// The short function words may stay lowercase ("Agents for Agencies", "Reports with AI"), unless
// they open the title or follow a colon; a phrasal particle takes its capital ("Clean Up").
const MINOR_WORDS = new Set(['a', 'an', 'the', 'and', 'but', 'or', 'nor', 'for', 'so', 'yet', 'as', 'at', 'by', 'in', 'of', 'off', 'on', 'per', 'to', 'up', 'via', 'vs', 'with', 'from', 'into', 'onto', 'over', 'than'])
const LOWERCASE_NAMES = new Set(['n8n', 'iOS', 'macOS'])

// The words of an English page title left in sentence case, empty when it is in headline case. A
// hyphenated word is judged by its first part, so "E-commerce" and "Step-by-Step" both pass.
export function headlineCaseProblems(title) {
    const words = title
        .replace(/\{[^{}]*\}/g, ' ')
        .split(/\s+/)
        .filter(Boolean)
    const problems = []
    let opensClause = true
    for (const raw of words) {
        const word = raw.replace(/^[("'“]+|[)"'”.,:;!?]+$/g, '')
        const startsClause = opensClause
        opensClause = /[:?!]$/.test(raw)
        if (!/^[a-z]/.test(word) || LOWERCASE_NAMES.has(word)) continue
        const lead = word.split('-')[0]
        if (startsClause || !MINOR_WORDS.has(lead)) problems.push(raw)
    }
    return problems
}

// A longer language may take more room, within reason: past this the layout is likely to break.
export function tooLong(source, translation) {
    return translation.length > Math.max(source.length * 1.4, source.length + 12)
}

export function indexSource(locale) {
    const list = namespaces(locale)
    const identifier = ns => ns.replace(/[^A-Za-z0-9]+(.)/g, (_, char) => char.toUpperCase())
    return [
        '// Generated by `pnpm i18n:translate` from the JSON files of this folder: do not edit.',
        ...list.map(ns => `import ${identifier(ns)} from './${ns}.json'`),
        '',
        `export default { ${list.map(ns => (identifier(ns) === ns ? ns : `'${ns}': ${identifier(ns)}`)).join(', ')} }`,
        '',
    ].join('\n')
}

export function indexFile(locale) {
    return path.join(MESSAGES_DIR, locale, 'index.ts')
}

export function writeIndexes() {
    for (const locale of [SOURCE_LOCALE, ...targetLocales()]) {
        if (existsSync(path.join(MESSAGES_DIR, locale))) writeFileSync(indexFile(locale), indexSource(locale))
    }
}
