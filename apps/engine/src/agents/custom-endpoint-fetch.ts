import { CUSTOM_ENDPOINT_REFUSED } from '@rerun/contracts'
import { Agent as UndiciAgent } from 'undici'
import { refusalMessageOf, refusalResponse } from '../lib/refusal-body.js'

// A local model on modest hardware reads a long prompt for minutes before its first token, and
// sends no response header until then: past the five minutes Node allows, the request is dropped and
// retried from scratch, three times over. Measured on a CPU box: a 20k-token prompt takes 25 minutes.
export const CUSTOM_ENDPOINT_PATIENCE_MS = 60 * 60_000
const customEndpointDispatcher = new UndiciAgent({ headersTimeout: CUSTOM_ENDPOINT_PATIENCE_MS, bodyTimeout: CUSTOM_ENDPOINT_PATIENCE_MS })

// A proxy or a host in front of the endpoint can answer its 402 with a whole page: only a sentence is
// worth keeping as the reason.
const REASON_MAX_LENGTH = 500

function reasonOf(text: string, statusText: string): string {
    const reason = refusalMessageOf(text)
    if (!reason || reason.startsWith('<')) return statusText || 'Payment Required'
    return reason.length > REASON_MAX_LENGTH ? `${reason.slice(0, REASON_MAX_LENGTH)}…` : reason
}

type ContentPart = { type?: unknown; text?: unknown; thinking?: unknown }

const CONTENT_AS_PARTS = /"content"\s*:\s*\[/

function textOfParts(parts: unknown): string {
    if (!Array.isArray(parts)) return ''
    return parts.map(part => ((part as ContentPart)?.type === 'text' && typeof (part as ContentPart).text === 'string' ? (part as ContentPart).text : '')).join('')
}

function withStringContent(message: unknown): unknown {
    if (!message || typeof message !== 'object' || !Array.isArray((message as { content?: unknown }).content)) return message
    const { content, ...rest } = message as { content: ContentPart[] }
    const text = textOfParts(content)
    const reasoning = content.map(part => (part?.type === 'thinking' ? textOfParts(part.thinking) : '')).join('')
    return { ...rest, ...(text ? { content: text } : {}), ...(reasoning ? { reasoning_content: reasoning } : {}) }
}

// Mistral's reasoning models (`mistral-large-latest`) send `content` as a list of parts, the thought
// in `thinking` ones, where the OpenAI chat format has a string: the SDK then refuses the whole
// answer. The thought goes to `reasoning_content`, which is read as a DeepSeek's is.
function withStringContents(json: string): string {
    if (!CONTENT_AS_PARTS.test(json)) return json
    let body: { choices?: unknown }
    try {
        body = JSON.parse(json) as { choices?: unknown }
    } catch {
        return json
    }
    if (!Array.isArray(body.choices)) return json
    const choices = body.choices.map(choice => {
        const { delta, message, ...rest } = (choice ?? {}) as { delta?: unknown; message?: unknown }
        return { ...rest, ...(delta ? { delta: withStringContent(delta) } : {}), ...(message ? { message: withStringContent(message) } : {}) }
    })
    return JSON.stringify({ ...body, choices })
}

function sseLineWithStringContents(line: string): string {
    if (!line.startsWith('data:') || !CONTENT_AS_PARTS.test(line)) return line
    return `data: ${withStringContents(line.slice('data:'.length).trim())}`
}

function sseWithStringContents(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
    const decoder = new TextDecoder()
    const encoder = new TextEncoder()
    let partialLine = ''
    return body.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
            transform(bytes, controller) {
                const lines = (partialLine + decoder.decode(bytes, { stream: true })).split('\n')
                partialLine = lines.pop() ?? ''
                for (const line of lines) controller.enqueue(encoder.encode(`${sseLineWithStringContents(line)}\n`))
            },
            flush(controller) {
                const rest = partialLine + decoder.decode()
                if (rest) controller.enqueue(encoder.encode(sseLineWithStringContents(rest)))
            },
        }),
    )
}

function withBody(response: Response, body: BodyInit): Response {
    const headers = new Headers(response.headers)
    headers.delete('content-length')
    headers.delete('content-encoding')
    return new Response(body, { status: response.status, statusText: response.statusText, headers })
}

async function withStringContentsResponse(response: Response): Promise<Response> {
    if (!response.ok || !response.body) return response
    const contentType = response.headers.get('content-type') ?? ''
    if (contentType.includes('text/event-stream')) return withBody(response, sseWithStringContents(response.body))
    if (contentType.includes('application/json')) return withBody(response, withStringContents(await response.text()))
    return response
}

// xAI answers a spent account with `{ error: "<sentence>" }`, which the OpenAI SDK skips for the bare
// "Payment Required", and the chat reads that as Rerun credits used up. What a 402 means is up to
// each server, so its own words are kept, under a sentence the chat shows as it is.
export function customEndpointFetch(inner: typeof fetch = fetch): typeof fetch {
    return async (input, init) => {
        const response = await inner(input, { ...init, dispatcher: customEndpointDispatcher } as RequestInit)
        if (response.status !== 402) return withStringContentsResponse(response)
        const text = await response.text()
        return refusalResponse(response, text, `${CUSTOM_ENDPOINT_REFUSED}: ${reasonOf(text, response.statusText)}`, 'custom')
    }
}
