export type TriggerPayload = {
    prompt: string
    slug: string
    method: string
    receivedAt: string
    query?: string
    contentType?: string
    bytes: number
    truncated: boolean
    body: string
    isJson: boolean
}

const TRIGGER_BLOCK = /\n*<trigger_payload ((?:[^>"]|"[^"]*")*)>\n?([\s\S]*?)\n?<\/trigger_payload>\s*$/
const TRIGGER_ATTRIBUTE = /([\w-]+)="([^"]*)"/g

export function parseTriggerPayload(text: string): TriggerPayload | null {
    const match = TRIGGER_BLOCK.exec(text)
    if (!match) return null

    const attributes = new Map<string, string>()
    for (const [, name, value] of match[1].matchAll(TRIGGER_ATTRIBUTE)) {
        attributes.set(name, value.replaceAll('&quot;', '"'))
    }

    const slug = attributes.get('trigger')
    const method = attributes.get('method')
    if (!slug || !method) return null

    const raw = match[2]
    const contentType = attributes.get('content-type')

    return {
        prompt: text.slice(0, match.index).trim(),
        slug,
        method,
        receivedAt: attributes.get('received') ?? '',
        query: attributes.get('query') || undefined,
        contentType: contentType || undefined,
        bytes: Number(attributes.get('bytes') ?? 0) || 0,
        truncated: attributes.get('truncated') === 'true',
        body: raw === '(no payload)' ? '' : raw.replaceAll('<\\/trigger_payload>', '</trigger_payload>'),
        isJson: !!contentType?.includes('json'),
    }
}

export type ScheduledRun = { slug: string; name: string; prompt: string }

const SCHEDULED_BLOCK = /^<scheduled_run schedule="([^"]*)" name="([^"]*)">\n?([\s\S]*?)\n?<\/scheduled_run>$/
const SCHEDULED_CLOSING_TAG = '</scheduled_run>'
const ESCAPED_SCHEDULED_CLOSING_TAG = '<\\/scheduled_run>'

function unescapeScheduledAttribute(value: string): string {
    return value.replaceAll('&quot;', '"').replaceAll('&amp;', '&')
}

export function parseScheduledRun(text: string): ScheduledRun | null {
    const match = SCHEDULED_BLOCK.exec(text.trim())
    if (!match) return null
    const slug = unescapeScheduledAttribute(match[1])
    return {
        slug,
        name: unescapeScheduledAttribute(match[2]) || slug,
        prompt: match[3].replaceAll(ESCAPED_SCHEDULED_CLOSING_TAG, SCHEDULED_CLOSING_TAG),
    }
}

export type InstallMessage = { agentName: string; guide: string }

const INSTALL_BLOCK = /^<agent_install agent="([^"]*)">\n?([\s\S]*?)\n?<\/agent_install>$/
const INSTALL_CLOSING_TAG = '</agent_install>'
const ESCAPED_INSTALL_CLOSING_TAG = '<\\/agent_install>'

export function parseInstallMessage(text: string): InstallMessage | null {
    const match = INSTALL_BLOCK.exec(text.trim())
    if (!match) return null
    return {
        agentName: match[1].replaceAll('&quot;', '"').replaceAll('&amp;', '&'),
        guide: match[2].replaceAll(ESCAPED_INSTALL_CLOSING_TAG, INSTALL_CLOSING_TAG),
    }
}
