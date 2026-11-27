import type { LanguageModelMiddleware } from 'ai'
import { HITL_TOOL_NAMES, stripBridgePrefix } from '@rerun/contracts'
import { logger } from '../lib/logger.js'

// A model that closes its message with a <quick_replies> block learns that a tag in its text turns
// into an element of the chat, and writes a card the same way: `<ask_user>` as text, no tool call.
// The prompt forbids it and Opus writes it anyway, so the tag is cut out of the text on its way.
export const CARD_TAG_NAMES = Object.keys(HITL_TOOL_NAMES)

// The Claude CLI reads the history as one text where each earlier call is a `[Tool call: x({...})]`
// line at the end of its own turn, so on a long session the model writes the next call that way
// too (RER-404): the line runs nothing and shows its JSON. It always opens a line.
const TOOL_CALL_MARKER = '[Tool call: '
const TOOL_CALL_NAME = /^\s*\[Tool call: ([^(\s\]]+)/
// A call closed on its opening line, with or without an input: the greedy input runs to the last
// `)]`, so one inside a JSON string stays in it, and the model's own words after it are kept.
const CLOSED_TOOL_CALL = /^\s*\[Tool call: [^(\s\]]+(?:\(.*\))?\]/
// The last line of an input written over several lines, which opens on its closing brackets.
const CALL_CLOSING_LINE = /^\s*[}\]]*\)\]/
const CALL_CLOSE = ')]'
const afterCall = (rest: string): string | null => (/^[\s.,;:!?]*$/.test(rest) ? null : rest.trimStart())

export type TextCut = { kind: 'tag' | 'call'; name: string }

const BRIDGE_PREFIXES = ['', 'rerun__', 'mcp__rerun__']
const TAG_BODIES = BRIDGE_PREFIXES.flatMap(prefix => CARD_TAG_NAMES.map(name => `${prefix}${name}`))
const CARD_TAG = new RegExp(`<\\/?(?:mcp__rerun__|rerun__)?(${CARD_TAG_NAMES.join('|')})(?:\\s[^>]*)?\\/?>`, 'g')

const FENCE = /^\s*```/


// A `<` that opens a card tag, or could still once more text arrives: the tag name is incomplete,
// or complete and waiting for its `>`. Held back until its line ends, where the tags are cut.
function opensCardTag(text: string): boolean {
    const body = text.slice(1).replace(/^\//, '')
    return TAG_BODIES.some(candidate => candidate.startsWith(body) || (body.startsWith(candidate) && /^(?:\s[^>]*)?\/?(?:>|$)/.test(body.slice(candidate.length))))
}

// A tag right behind a backtick is inline code: a coworker explaining the format keeps its text.
const quoted = (line: string, offset: number): boolean => offset > 0 && line[offset - 1] === '`'

const couldOpenToolCall = (line: string): boolean => {
    const start = line.trimStart()
    return TOOL_CALL_MARKER.startsWith(start) || start.startsWith(TOOL_CALL_MARKER)
}

// `released` counts the characters of the current line already sent, which hold no tag. `gap` is
// trailing whitespace held back so a cut at the end leaves none behind. `inCall` is a tool call
// written as text whose input runs over several lines and has not closed yet.
type LineState = { line: string; released: number; inFence: boolean; gap: string; cut: boolean; inCall: boolean }

// Removes the cards written as text from one model call's text, delta by delta: the card tags, and
// the lines of a tool call written as `[Tool call: ...]`. Only the tail of a line from a `<` that
// could still become a tag is held back, or a whole line that could still open a call; the tags of
// a complete line go when it ends, and a line that held nothing but a tag goes whole. The text after
// a cut flows again. Inside a code fence everything stays.
export class CardTagSplitter {
    private readonly states = new Map<string, LineState>()

    constructor(private readonly onCut: (cut: TextCut) => void) {}

    delta(id: string, delta: string): string[] {
        const state = this.states.get(id) ?? { line: '', released: 0, inFence: false, gap: '', cut: false, inCall: false }
        this.states.set(id, state)
        let out = ''
        const emit = (text: string) => {
            const combined = state.gap + text
            const kept = combined.trimEnd().length
            out += combined.slice(0, kept)
            state.gap = combined.slice(kept)
        }
        let rest = delta
        while (rest) {
            const newline = rest.indexOf('\n')
            const piece = newline < 0 ? rest : rest.slice(0, newline + 1)
            rest = newline < 0 ? '' : rest.slice(newline + 1)
            state.line += piece
            if (piece.endsWith('\n')) {
                if (!state.inCall && FENCE.test(state.line)) state.inFence = !state.inFence
                const kept = this.clean(state, state.line)
                if (kept !== null) emit(kept.slice(state.released))
                state.line = ''
                state.released = 0
                continue
            }
            const hold = state.inFence ? -1 : this.holdFrom(state, state.line, state.released)
            const upTo = hold < 0 ? state.line.length : hold
            if (upTo > state.released) {
                emit(state.line.slice(state.released, upTo))
                state.released = upTo
            }
        }
        return out ? [out] : []
    }

    end(id: string): string[] {
        const state = this.states.get(id)
        this.states.delete(id)
        if (!state) return []
        const kept = this.clean(state, state.line)
        const rest = kept === null ? '' : kept.slice(state.released)
        if (rest) return [state.gap + rest]
        return state.cut || !state.gap ? [] : [state.gap]
    }

    // The line without its tags or its tool call written as text; `null` when they were all it held,
    // so the line goes whole. A call that never closes ends on the first blank line, which no JSON
    // holds, so the rest of the message is never lost with it.
    private clean(state: LineState, line: string): string | null {
        if (state.inCall) {
            if (!line.trim()) {
                state.inCall = false
                return line
            }
            const closing = CALL_CLOSING_LINE.exec(line)
            if (closing) {
                state.inCall = false
                return afterCall(line.slice(closing[0].length))
            }
            if (line.trimEnd().endsWith(CALL_CLOSE)) state.inCall = false
            return null
        }
        if (state.inFence) return line
        const call = TOOL_CALL_NAME.exec(line)
        if (call) {
            state.cut = true
            this.onCut({ kind: 'call', name: stripBridgePrefix(call[1]!) })
            const closed = CLOSED_TOOL_CALL.exec(line)
            state.inCall = !closed
            return closed ? afterCall(line.slice(closed[0].length)) : null
        }
        let removed = false
        const cleaned = line.replace(CARD_TAG, (match: string, name: string, offset: number) => {
            if (quoted(line, offset)) return match
            removed = true
            state.cut = true
            this.onCut({ kind: 'tag', name })
            return ''
        })
        return removed && !cleaned.trim() ? null : cleaned
    }

    private holdFrom(state: LineState, line: string, from: number): number {
        if (state.inCall || (from === 0 && couldOpenToolCall(line))) return from
        for (let i = line.indexOf('<', from); i >= 0; i = line.indexOf('<', i + 1)) {
            if (!quoted(line, i) && opensCardTag(line.slice(i))) return i
        }
        return -1
    }
}

// The Stop hook's view of a message is the stream's: a tag or a call in a code fence, or a tag in
// inline code, stays in the text, so it is no reason to hold the turn.
export function firstTextCut(text: string): TextCut | null {
    let first: TextCut | null = null
    const splitter = new CardTagSplitter(cut => (first ??= cut))
    splitter.delta('message', text)
    splitter.end('message')
    return first
}

type StreamPart = { type: string; id?: string; delta?: string; text?: string }

export function createCardTagGuard(agentId: string, provider: string): LanguageModelMiddleware {
    const splitter = () => new CardTagSplitter(cut => logger.warn({ agentId, provider, kind: cut.kind, tool: cut.name }, 'card or tool call cut from model text'))

    return {
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
                    }) as TransformStream
                ),
            }
        },
        async wrapGenerate({ doGenerate }) {
            const result = await doGenerate()
            const split = splitter()
            const content = result.content.flatMap((part, index): (typeof result.content)[number][] => {
                if (part.type !== 'text') return [part]
                const id = String(index)
                const text = [...split.delta(id, part.text), ...split.end(id)].join('')
                if (text === part.text) return [part]
                return text ? [{ ...part, text }] : []
            })
            return { ...result, content }
        },
    }
}
