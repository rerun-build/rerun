import type { LanguageModelMiddleware } from 'ai'
import { HITL_TOOL_NAMES } from '@moldwright/contracts'
import { logger } from '../lib/logger.js'

export const CARD_TAG_NAMES = Object.keys(HITL_TOOL_NAMES)

const BRIDGE_PREFIXES = ['', 'rerun__', 'mcp__rerun__']
const TAG_BODIES = BRIDGE_PREFIXES.flatMap(prefix => CARD_TAG_NAMES.map(name => `${prefix}${name}`))
const CARD_TAG = new RegExp(`<\\/?(?:mcp__rerun__|rerun__)?(${CARD_TAG_NAMES.join('|')})(?:\\s[^>]*)?\\/?>`, 'g')

const FENCE = /^\s*```/


function opensCardTag(text: string): boolean {
    const body = text.slice(1).replace(/^\//, '')
    return TAG_BODIES.some(candidate => candidate.startsWith(body) || (body.startsWith(candidate) && /^(?:\s[^>]*)?\/?(?:>|$)/.test(body.slice(candidate.length))))
}

const quoted = (line: string, offset: number): boolean => offset > 0 && line[offset - 1] === '`'

type LineState = { line: string; released: number; inFence: boolean; gap: string; cut: boolean }

export class CardTagSplitter {
    private readonly states = new Map<string, LineState>()

    constructor(private readonly onCut: (tag: string) => void) {}

    delta(id: string, delta: string): string[] {
        const state = this.states.get(id) ?? { line: '', released: 0, inFence: false, gap: '', cut: false }
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
                if (FENCE.test(state.line)) state.inFence = !state.inFence
                const kept = this.clean(state, state.line)
                if (kept !== null) emit(kept.slice(state.released))
                state.line = ''
                state.released = 0
                continue
            }
            const hold = state.inFence ? -1 : this.holdFrom(state.line, state.released)
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

    private clean(state: LineState, line: string): string | null {
        if (state.inFence) return line
        let removed = false
        const cleaned = line.replace(CARD_TAG, (match: string, name: string, offset: number) => {
            if (quoted(line, offset)) return match
            removed = true
            state.cut = true
            this.onCut(name)
            return ''
        })
        return removed && !cleaned.trim() ? null : cleaned
    }

    private holdFrom(line: string, from: number): number {
        for (let i = line.indexOf('<', from); i >= 0; i = line.indexOf('<', i + 1)) {
            if (!quoted(line, i) && opensCardTag(line.slice(i))) return i
        }
        return -1
    }
}

export function cutsCardTag(text: string): boolean {
    let cut = false
    const splitter = new CardTagSplitter(() => (cut = true))
    splitter.delta('message', text)
    splitter.end('message')
    return cut
}

type StreamPart = { type: string; id?: string; delta?: string; text?: string }

export function createCardTagGuard(agentId: string, provider: string): LanguageModelMiddleware {
    const splitter = () => new CardTagSplitter(tag => logger.warn({ agentId, provider, tag }, 'card tag cut from model text'))

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
