import { readHeroAgentApps, readHeroAgentName } from '@/lib/onboarding/hero-handoff'

export const KICKOFF_MARKER = '[[foreman:start]]'

export type PromptIntent = { kind: 'prompt'; text: string; name?: string; apps?: string[] }

export type KickoffIntent = { kind: 'template'; slug: string } | { kind: 'share'; token: string } | PromptIntent

const OPEN = '[[foreman:start'
const CLOSE = ']]'

const PROMPT_FIELD = ':prompt'

const OWN_FIELD = ':own'

function promptExtras(intent: PromptIntent): string {
    const query = new URLSearchParams()
    if (intent.name) query.set('name', intent.name)
    if (intent.apps?.length) query.set('apps', intent.apps.join(','))
    const extras = query.toString()
    return extras ? `:${extras}` : ''
}

function readPromptExtras(field: string): Pick<PromptIntent, 'name' | 'apps'> {
    const query = new URLSearchParams(field.slice(PROMPT_FIELD.length + 1))
    const name = readHeroAgentName(query)
    const apps = readHeroAgentApps(query)
    return { ...(name ? { name } : {}), ...(apps.length ? { apps } : {}) }
}

export function buildKickoffMarker(intent: KickoffIntent | null): string {
    if (!intent) return KICKOFF_MARKER
    if (intent.kind === 'prompt') return `${OPEN}${PROMPT_FIELD}${promptExtras(intent)}${CLOSE}\n${intent.text}`
    return `${OPEN}:${intent.kind}:${intent.kind === 'template' ? intent.slug : intent.token}${CLOSE}`
}

export function parseKickoff(text: string): { intent: KickoffIntent | null } | null {
    const [head, ...rest] = text.trim().split('\n')
    const line = head.trim()
    if (!line.startsWith(OPEN) || !line.endsWith(CLOSE)) return null

    const field = line.slice(OPEN.length, -CLOSE.length)
    if (!field) return { intent: null }
    if (field === PROMPT_FIELD || field.startsWith(`${PROMPT_FIELD}:`)) {
        const body = rest.join('\n').trim()
        return { intent: body ? { kind: 'prompt', text: body, ...readPromptExtras(field) } : null }
    }

    const [, kind, ...value] = field.split(':')
    const payload = value.join(':').trim()
    if (!payload) return { intent: null }
    if (kind === 'template') return { intent: { kind: 'template', slug: payload } }
    if (kind === 'share') return { intent: { kind: 'share', token: payload } }
    return { intent: null }
}

export function buildOwnKickoff(asked: string): string {
    return `${OPEN}${OWN_FIELD}${CLOSE}\n${asked.trim()}`
}

export function readOwnAsk(text: string): string | null {
    const [head, ...rest] = text.trim().split('\n')
    if (head.trim() !== `${OPEN}${OWN_FIELD}${CLOSE}`) return null
    return rest.join('\n').trim() || null
}

export function isKickoffText(text: string): boolean {
    return parseKickoff(text) !== null
}

export function stripKickoff(text: string): string {
    const parsed = parseKickoff(text)
    if (!parsed) return text
    return parsed.intent?.kind === 'prompt' ? parsed.intent.text : (readOwnAsk(text) ?? '')
}

export function encodeIntent(intent: KickoffIntent): string {
    return intent.kind === 'prompt' ? 'prompt' : `${intent.kind}:${intent.kind === 'template' ? intent.slug : intent.token}`
}

export function decodeIntent(value: string | null): KickoffIntent | null {
    if (!value) return null
    if (value === 'prompt') return { kind: 'prompt', text: '' }
    const [kind, ...rest] = value.split(':')
    const payload = rest.join(':').trim()
    if (!payload) return null
    if (kind === 'template') return { kind: 'template', slug: payload }
    if (kind === 'share') return { kind: 'share', token: payload }
    return null
}
