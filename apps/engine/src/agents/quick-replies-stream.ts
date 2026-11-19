import type { LanguageModelMiddleware, ModelMessage } from 'ai'
import { QUICK_REPLIES_MAX, QUICK_REPLIES_TOOL, QUICK_REPLY_MAX_LENGTH, parseQuickReplies, stripBridgePrefix, type AgentConfig } from '@rerun/contracts'
import { newId } from '../lib/ids.js'

export const QUICK_REPLIES_OPEN = '<quick_replies>'
export const QUICK_REPLIES_CLOSE = '</quick_replies>'

export type QuickRepliesCapture = { toolCallId: string; replies: string[] }

export type QuickRepliesCaptureHandle = { middleware: LanguageModelMiddleware; read: () => QuickRepliesCapture | undefined }

// A sub-agent answers another agent: nobody is there to click.
export function offersQuickReplies(config: AgentConfig): boolean {
    return config.tools.quickReplies && !config.ephemeral
}

export function quickRepliesCall(capture: QuickRepliesCapture): { toolCallId: string; toolName: string; input: { replies: string[] } } {
    return { toolCallId: capture.toolCallId, toolName: QUICK_REPLIES_TOOL, input: { replies: capture.replies } }
}

const BULLET = /^(?:[-*•]|\d+[.)])\s+/
const QUOTES = /^["'“”‘’«»\s]+|["'“”‘’«»\s]+$/g

// The model is told the limits, but a reply over them must not sink the whole block as
// `parseQuickReplies` would: the list is trimmed to what fits first.
export function parseQuickRepliesBlock(body: string): string[] {
    const replies = body
        .split('\n')
        .map(line => line.trim().replace(BULLET, '').replace(QUOTES, ''))
        .filter(line => line && line.length <= QUICK_REPLY_MAX_LENGTH)
        .slice(0, QUICK_REPLIES_MAX)
    const result = parseQuickReplies({ replies })
    return result.ok ? result.replies : []
}

const FENCE_OPENER_TAIL = /```[a-zA-Z]*[ \t]*\n?$/
const FENCE_OPENER = /^```[a-zA-Z]*(\n)?/
const AFTER_CLOSE = /^\n?(?:```\n?)?/
const CLOSERS = ['\n```\n', '```\n']

// A suffix the stream has to hold back: whitespace that may be the gap before the block, then
// what may be the start of the opening tag, bare or behind the code fence a model sometimes wraps
// it in. Anything else is released at once.
function couldStartBlock(suffix: string): boolean {
    const rest = suffix.replace(/^\s+/, '')
    if (rest === '' || QUICK_REPLIES_OPEN.startsWith(rest) || '```'.startsWith(rest)) return true
    const fence = rest.match(FENCE_OPENER)
    if (!fence) return false
    const tag = rest.slice(fence[0].length)
    return tag === '' ? true : fence[1] !== undefined && QUICK_REPLIES_OPEN.startsWith(tag)
}

function holdbackLength(text: string): number {
    const max = Math.min(text.length, QUICK_REPLIES_OPEN.length + 24)
    for (let len = max; len > 0; len--) {
        if (couldStartBlock(text.slice(text.length - len))) return len
    }
    return 0
}

// Right after the closing tag, the line break and the fence a model may close the block with are
// not part of the message either.
const couldCloseFence = (text: string): boolean => CLOSERS.some(closer => closer.startsWith(text))

type Mode = 'text' | 'block' | 'after'
type BlockState = { pending: string; mode: Mode }

// Cuts the block out of one text block of the stream, delta by delta. In text mode, everything
// but a tail that could still turn into the tag goes out as it comes; once the tag opened, nothing
// goes out until it closes or the text ends. The text after a closed block flows again.
export class QuickRepliesSplitter {
    private readonly states = new Map<string, BlockState>()

    constructor(private readonly onBlock: (replies: string[]) => void) {}

    delta(id: string, delta: string): string[] {
        const state = this.states.get(id) ?? { pending: '', mode: 'text' as Mode }
        this.states.set(id, state)
        state.pending += delta
        const out: string[] = []
        while (true) {
            if (state.mode === 'after') {
                if (couldCloseFence(state.pending)) break
                state.pending = state.pending.replace(AFTER_CLOSE, '')
                state.mode = 'text'
            }
            if (state.mode === 'text') {
                const open = state.pending.indexOf(QUICK_REPLIES_OPEN)
                if (open < 0) {
                    const hold = holdbackLength(state.pending)
                    const release = state.pending.slice(0, state.pending.length - hold)
                    if (release) out.push(release)
                    state.pending = state.pending.slice(state.pending.length - hold)
                    break
                }
                const before = state.pending.slice(0, open).replace(FENCE_OPENER_TAIL, '').replace(/\s+$/, '')
                if (before) out.push(before)
                state.pending = state.pending.slice(open + QUICK_REPLIES_OPEN.length)
                state.mode = 'block'
            }
            const close = state.pending.indexOf(QUICK_REPLIES_CLOSE)
            if (close < 0) break
            this.record(state.pending.slice(0, close))
            state.pending = state.pending.slice(close + QUICK_REPLIES_CLOSE.length)
            state.mode = 'after'
        }
        return out
    }

    end(id: string): string[] {
        const state = this.states.get(id)
        this.states.delete(id)
        if (!state) return []
        if (state.mode === 'block') {
            this.record(state.pending)
            return []
        }
        if (state.mode === 'after') return []
        return state.pending ? [state.pending] : []
    }

    private record(body: string): void {
        const replies = parseQuickRepliesBlock(body)
        if (replies.length > 0) this.onBlock(replies)
    }
}

type StreamPart = { type: string; id?: string; delta?: string; text?: string }

export function createQuickRepliesCapture(): QuickRepliesCaptureHandle {
    const toolCallId = newId()
    let replies: string[] | undefined
    const splitter = () => new QuickRepliesSplitter(found => (replies = found))

    const middleware: LanguageModelMiddleware = {
        specificationVersion: 'v3',
        async wrapStream({ doStream }) {
            const result = await doStream()
            const split = splitter()
            return {
                ...result,
                stream: result.stream.pipeThrough(
                    new TransformStream<StreamPart, StreamPart>({
                        transform(part, controller) {
                            if (part.type === 'text-delta' && typeof part.id === 'string' && typeof part.delta === 'string') {
                                for (const delta of split.delta(part.id, part.delta)) controller.enqueue({ ...part, delta })
                                return
                            }
                            if (part.type === 'text-end' && typeof part.id === 'string') {
                                for (const delta of split.end(part.id)) controller.enqueue({ type: 'text-delta', id: part.id, delta })
                            }
                            controller.enqueue(part)
                        },
                    }) as TransformStream,
                ),
            }
        },
        async wrapGenerate({ doGenerate }) {
            const result = await doGenerate()
            const split = splitter()
            const content = result.content.map((part, index) => {
                if (part.type !== 'text') return part
                const id = String(index)
                const text = [...split.delta(id, part.text), ...split.end(id)].join('')
                return text === part.text ? part : { ...part, text }
            })
            return { ...result, content }
        },
    }

    return { middleware, read: () => (replies ? { toolCallId, replies } : undefined) }
}

// The call the old tool left in stored turns. A model that sees it imitates a call to a tool that
// no longer exists, so the history the model reads goes without it; a turn that held nothing else
// goes entirely.
export function withoutQuickRepliesCalls(message: ModelMessage): ModelMessage | null {
    if (!Array.isArray(message.content)) return message
    const content = message.content.filter(part => {
        const p = part as { type?: string; toolName?: string }
        return !(p.type === 'tool-call' && stripBridgePrefix(p.toolName ?? '') === QUICK_REPLIES_TOOL)
    })
    if (content.length === message.content.length) return message
    if (content.length === 0) return null
    return { ...message, content } as ModelMessage
}
