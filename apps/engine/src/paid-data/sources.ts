// Turns a paid data answer into the values a table cell can be traced back to. Knows no capability:
// whatever the provider sent, the items are the objects of its lists and the keys come from what the
// values look like (an email, a phone, a website) or from the few fields that name someone.

import { isRecord } from '@rerun/contracts'

export type PaidScalar = string | number | boolean
export type PaidItem = { fields: Record<string, PaidScalar>; href?: string }
export type PaidItemKey = { key: string; field: string }

export const MAX_PAID_ITEMS = 500
const MAX_ITEM_FIELDS = 12
const MAX_FIELD_CHARS = 500

// Hosts shared by every business that has a page on them: a key on the host alone would tie a row to
// every item of a call. A path on them still names one page, so it is kept with its query.
const GENERIC_HOSTS = ['google.com', 'goo.gl', 'g.page', 'googleusercontent.com', 'gstatic.com', 'facebook.com', 'fb.com', 'instagram.com', 'linkedin.com', 'x.com', 'twitter.com', 'tiktok.com', 'youtube.com', 'youtu.be', 'pinterest.com', 'reddit.com', 'wa.me', 'whatsapp.com', 't.me', 'linktr.ee', 'bit.ly', 'yelp.com', 'tripadvisor.com', 'booking.com', 'medium.com', 'github.com', 'wikipedia.org', 'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'yahoo.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com']

function isGenericHost(host: string): boolean {
    if (/^(?:.+\.)?google\.[a-z.]+$/.test(host)) return true
    return GENERIC_HOSTS.some(generic => host === generic || host.endsWith(`.${generic}`))
}

export function normalizeText(value: string): string {
    return value
        .normalize('NFKD')
        .replace(/\p{M}+/gu, '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim()
}

const EMAIL = /^[^\s@<>()[\],;:"']+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}$/

export function emailKey(value: string): string | null {
    const email = value
        .trim()
        .toLowerCase()
        .replace(/^mailto:/, '')
    return EMAIL.test(email) ? `e:${email}` : null
}

const PHONE_SHAPE = /^\+?[\d\s().\-/]+$/

export function phoneKey(value: string | number): string | null {
    const text = String(value).trim().replace(/^tel:/i, '')
    if (!PHONE_SHAPE.test(text)) return null
    const digits = text.replace(/\D/g, '')
    return digits.length >= 8 && digits.length <= 15 ? `p:${digits.slice(-9)}` : null
}

const HOST = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/

function decodeSafe(text: string): string {
    try {
        return decodeURIComponent(text)
    } catch {
        return text
    }
}

export function webKeys(value: string): string[] {
    let text = value.trim().toLowerCase()
    if (!text || /\s/.test(text)) return []
    const scheme = /^[a-z][a-z0-9+.-]*:\/\//
    if (!scheme.test(text) && text.includes('@')) return []
    text = text.replace(scheme, '').split('#')[0]
    const queryAt = text.indexOf('?')
    const query = queryAt >= 0 ? text.slice(queryAt + 1) : ''
    const location = queryAt >= 0 ? text.slice(0, queryAt) : text
    const slashAt = location.indexOf('/')
    const host = (slashAt >= 0 ? location.slice(0, slashAt) : location).replace(/:\d+$/, '').replace(/^www\./, '')
    const path = (slashAt >= 0 ? location.slice(slashAt) : '').replace(/\/+$/, '')
    if (!HOST.test(host)) return []

    if (host === 'linkedin.com' || host.endsWith('.linkedin.com')) {
        const profile = /^\/(?:in|company)\/([^/]+)/.exec(path)
        if (profile) return [`li:${decodeSafe(profile[1])}`]
    }
    if (isGenericHost(host)) return path || query ? [`u:${host}${path}${query ? `?${query}` : ''}`] : []
    return path ? [`d:${host}`, `u:${host}${path}`] : [`d:${host}`]
}

export function nameKey(value: string): string | null {
    const name = normalizeText(value)
    return name.length >= 3 && name.length <= 120 ? `n:${name}` : null
}

export const isWeakKey = (key: string): boolean => key.startsWith('n:')

const leafOf = (field: string): string => field.slice(field.lastIndexOf('.') + 1).toLowerCase()

const PHONE_FIELD = /phone|mobile|^tel$|telephone|^tel_|_tel$/
const WEB_FIELD = /website|domain|url|site|link|homepage|linkedin|facebook|instagram|twitter|tiktok|youtube/
const MEDIA_FIELD = /image|photo|thumbnail|thumb|logo|avatar|icon|picture|img|favicon|banner|video|cover|media/
const OWN_NAME_FIELDS = new Set(['name', 'full_name', 'fullname', 'display_name'])
const NAME_FIELDS = new Set([...OWN_NAME_FIELDS, 'company', 'company_name', 'business_name', 'organization', 'organization_name', 'org_name'])
const NAMED_PARENTS = new Set(['company', 'organization', 'org', 'employer', 'business'])
const HREF_PREFERENCE = [/^website$/, /^(?:url|link)$/, /linkedin/, /website|homepage|domain/, /maps|place/]

const isPhoneField = (field: string): boolean => PHONE_FIELD.test(leafOf(field))
export const isWebField = (field: string): boolean => WEB_FIELD.test(leafOf(field)) && !MEDIA_FIELD.test(leafOf(field))

// A place's `title` is its name, a person's is the job: it only names the item when nothing else does.
function nameFieldsOf(fields: string[]): Set<string> {
    const names = new Set<string>()
    for (const field of fields) {
        const parts = field.toLowerCase().split('.')
        if (parts.length === 1 && NAME_FIELDS.has(parts[0])) names.add(field)
        if (parts.length === 2 && NAMED_PARENTS.has(parts[0]) && parts[1] === 'name') names.add(field)
    }
    const hasOwnName = fields.some(field => OWN_NAME_FIELDS.has(field.toLowerCase()))
    if (!hasOwnName) for (const field of fields) if (field.toLowerCase() === 'title') names.add(field)
    return names
}

function scalarOf(value: unknown): PaidScalar | null {
    if (typeof value === 'string') {
        const text = value.trim()
        return text ? text.slice(0, MAX_FIELD_CHARS) : null
    }
    if (typeof value === 'number') return Number.isFinite(value) ? value : null
    return typeof value === 'boolean' ? value : null
}

function flatten(source: Record<string, unknown>): [string, PaidScalar][] {
    const entries: [string, PaidScalar][] = []
    const nested: [string, PaidScalar][] = []
    for (const [field, value] of Object.entries(source)) {
        const scalar = scalarOf(value)
        if (scalar !== null) entries.push([field, scalar])
        else if (isRecord(value)) {
            for (const [child, childValue] of Object.entries(value)) {
                const childScalar = scalarOf(childValue)
                if (childScalar !== null) nested.push([`${field}.${child}`, childScalar])
            }
        }
    }
    return [...entries, ...nested]
}

function withFullName(entries: [string, PaidScalar][]): [string, PaidScalar][] {
    const byField = new Map(entries.map(([field, value]) => [field.toLowerCase(), value]))
    if (byField.has('name') || byField.has('full_name')) return entries
    const first = byField.get('first_name')
    const last = byField.get('last_name')
    return typeof first === 'string' && typeof last === 'string' ? [['full_name', `${first} ${last}`], ...entries] : entries
}

function keysOfField(field: string, value: PaidScalar, names: Set<string>): string[] {
    if (typeof value === 'boolean') return []
    const keys: string[] = []
    if (typeof value === 'string') {
        const email = emailKey(value)
        if (email) return [email]
    }
    if (isPhoneField(field)) {
        const phone = phoneKey(value)
        if (phone) keys.push(phone)
    }
    if (typeof value === 'string' && isWebField(field)) keys.push(...webKeys(value))
    if (typeof value === 'string' && names.has(field)) {
        const name = nameKey(value)
        if (name) keys.push(name)
    }
    return keys
}

function hrefOf(fields: Record<string, PaidScalar>): string | undefined {
    const candidates = Object.entries(fields).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && isWebField(entry[0]) && webKeys(entry[1]).length > 0)
    for (const preference of HREF_PREFERENCE) {
        const match = candidates.find(([field]) => preference.test(leafOf(field)))
        if (match) return toHref(match[1])
    }
    return candidates[0] ? toHref(candidates[0][1]) : undefined
}

export const toHref = (value: string): string => (/^https?:\/\//i.test(value) ? value : `https://${value.replace(/^\/+/, '')}`)

function toItem(source: Record<string, unknown>): PaidItem {
    const entries = withFullName(flatten(source))
    const names = nameFieldsOf(entries.map(([field]) => field))
    const keyed = entries.filter(([field, value]) => keysOfField(field, value, names).length > 0)
    const rest = entries.filter(entry => !keyed.includes(entry))
    const fields = Object.fromEntries([...keyed, ...rest].slice(0, MAX_ITEM_FIELDS))
    const href = hrefOf(fields)
    return href ? { fields, href } : { fields }
}

export function paidItemKeys(item: PaidItem): PaidItemKey[] {
    const names = nameFieldsOf(Object.keys(item.fields))
    const seen = new Set<string>()
    const keys: PaidItemKey[] = []
    for (const [field, value] of Object.entries(item.fields)) {
        for (const key of keysOfField(field, value, names)) {
            if (seen.has(`${key}\n${field}`)) continue
            seen.add(`${key}\n${field}`)
            keys.push({ key, field })
        }
    }
    return keys
}

const hasStrongKey = (item: PaidItem): boolean => paidItemKeys(item).some(({ key }) => !isWeakKey(key))

// The items of an answer are the objects of its lists (output.places[], output.people[]). The answer
// itself is one more item when it carries its own email, phone or website (a company enrichment
// with its funding rounds), and the only one when it has no list at all.
export function extractPaidItems(output: unknown): PaidItem[] {
    const objectsOf = (list: unknown[]) => list.filter(isRecord)
    if (Array.isArray(output))
        return objectsOf(output)
            .slice(0, MAX_PAID_ITEMS)
            .map(toItem)
            .filter(item => Object.keys(item.fields).length > 0)
    if (!isRecord(output)) return []
    const listed = Object.values(output).flatMap(value => (Array.isArray(value) ? objectsOf(value) : []))
    const own = toItem(output)
    const items = listed.length ? [...(hasStrongKey(own) ? [own] : []), ...listed.slice(0, MAX_PAID_ITEMS).map(toItem)] : [own]
    return items.filter(item => Object.keys(item.fields).length > 0).slice(0, MAX_PAID_ITEMS)
}

// The keys a table cell is looked up by. The column name only helps read a bare number as a phone.
export function cellKeys(column: string, value: PaidScalar | null): { strong: string[]; weak: string | null } {
    if (value === null || typeof value === 'boolean') return { strong: [], weak: null }
    if (typeof value === 'number') {
        const phone = PHONE_FIELD.test(column.toLowerCase()) ? phoneKey(value) : null
        return { strong: phone ? [phone] : [], weak: null }
    }
    const email = emailKey(value)
    if (email) return { strong: [email], weak: null }
    const phone = phoneKey(value)
    if (phone) return { strong: [phone], weak: null }
    const web = webKeys(value)
    if (web.length) return { strong: web, weak: null }
    return { strong: [], weak: nameKey(value) }
}

// What a value equals once normalized, to tie a cell to a field of an item its row already matched.
export function equalityKeys(column: string, value: PaidScalar | null): string[] {
    if (value === null || typeof value === 'boolean') return []
    const { strong } = cellKeys(column, value)
    if (typeof value === 'number') return strong
    const text = normalizeText(value)
    return text.length >= 2 ? [...strong, `t:${text}`] : strong
}

type PaidResultLike = { output?: { status?: unknown } | null; verification?: { verdict?: unknown } | null } | null | undefined

const lowerText = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : undefined)

// The email check a call carries: a finder's verification of the address it found, or the verdict of
// a verification bought on its own, for the address it was given.
export function paidCallVerdict(capability: string, params: unknown, result: unknown): { verdict?: string; verifiedEmail?: string } {
    const answer = result as PaidResultLike
    if (capability === 'people.email.verify') {
        const email = isRecord(params) && typeof params.email === 'string' ? params.email : undefined
        const verdict = lowerText(answer?.output?.status)
        return email && verdict ? { verdict, verifiedEmail: email } : {}
    }
    const verdict = lowerText(answer?.verification?.verdict)
    return verdict ? { verdict } : {}
}
