import type { TriggerFireInput } from '@rerun/contracts'
import type { Trigger } from './loader.js'

export const MAX_PAYLOAD_BYTES = 65_536

function attr(value: string): string {
    return value.replace(/"/g, '&quot;').slice(0, 200)
}

function pretty(body: string, contentType: string): string {
    if (!contentType.includes('json')) return body
    try {
        return JSON.stringify(JSON.parse(body), null, 2)
    } catch {
        return body
    }
}

function truncate(text: string, totalBytes: number): { text: string; truncated: boolean } {
    if (Buffer.byteLength(text, 'utf8') <= MAX_PAYLOAD_BYTES) return { text, truncated: false }
    const cut = Buffer.from(text, 'utf8').subarray(0, MAX_PAYLOAD_BYTES).toString('utf8')
    return { text: `${cut}\n… [truncated, ${totalBytes} bytes total]`, truncated: true }
}

export function buildTriggerMessage(trigger: Trigger, fire: TriggerFireInput, receivedAt: string): string {
    const attrs = [
        `trigger="${attr(trigger.slug)}"`,
        `method="${attr(fire.method)}"`,
        `received="${attr(receivedAt)}"`,
    ]
    if (fire.query) attrs.push(`query="${attr(fire.query)}"`)
    if (fire.contentType) attrs.push(`content-type="${attr(fire.contentType)}"`)
    attrs.push(`bytes="${fire.bodyBytes}"`)

    const raw = fire.body.trim()
    if (!raw) return `${trigger.body.trim()}\n\n<trigger_payload ${attrs.join(' ')}>(no payload)</trigger_payload>`

    const escaped = pretty(raw, fire.contentType).replaceAll('</trigger_payload>', '<\\/trigger_payload>')
    const { text, truncated } = truncate(escaped, fire.bodyBytes)
    if (truncated) attrs.push('truncated="true"')

    return `${trigger.body.trim()}\n\n<trigger_payload ${attrs.join(' ')}>\n${text}\n</trigger_payload>`
}
