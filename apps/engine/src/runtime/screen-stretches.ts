import { wrapLanguageModel, type LanguageModelMiddleware, type ModelMessage } from 'ai'
import { SCREEN_TOOLS } from '@rerun/contracts'
import type { ResolvedModel } from '../agents/providers.js'
import { sum } from '../lib/sum.js'
import { canonicalBridgeName, findPendingHitl, isHitlToolName } from '../tools/builtin/hitl.js'
import { parsedInput } from '../tools/mcp-wire.js'
import { repairToolPairs, withToolResultsInToolMessages } from './compaction/repair.js'
import { withoutReasoning } from './replayed-reasoning.js'
import type { ScreenBudget } from './screen-budget.js'
import { streamedTurn } from './streamed-turn.js'

type WrapStream = NonNullable<LanguageModelMiddleware['wrapStream']>
type StreamOptions = Parameters<WrapStream>[0]
type CallParams = StreamOptions['params']
type StreamResult = Awaited<ReturnType<StreamOptions['doStream']>>
type StreamPart = StreamResult['stream'] extends ReadableStream<infer Part> ? Part : never
type FinishPart = Extract<StreamPart, { type: 'finish' }>
type Usage = FinishPart['usage']

export const CARRY_ON_NOTE =
    'You had used up the screenshots of one stretch, and this turn goes on by itself: the user was told nothing and is not waiting to relaunch you. Everything above is already done, do not redo it. The earlier screenshots are gone but what you noted from them stands: take a screenshot first, then carry on from your note. Never mention this pause to the user. If the work is finished or something only the user can do blocks it, say so and end your turn.'

function addUsage(a: Usage | undefined, b: Usage): Usage {
    if (!a) return b
    return {
        ...b,
        inputTokens: {
            total: sum(a.inputTokens.total, b.inputTokens.total),
            noCache: sum(a.inputTokens.noCache, b.inputTokens.noCache),
            cacheRead: sum(a.inputTokens.cacheRead, b.inputTokens.cacheRead),
            cacheWrite: sum(a.inputTokens.cacheWrite, b.inputTokens.cacheWrite),
        },
        outputTokens: {
            total: sum(a.outputTokens.total, b.outputTokens.total),
            text: sum(a.outputTokens.text, b.outputTokens.text),
            reasoning: sum(a.outputTokens.reasoning, b.outputTokens.reasoning),
        },
    }
}

// Each session numbers its blocks and its calls from the start again, and the chat reads the whole
// turn as one message: an id used twice would overwrite what it first named.
function renamer(taken: Set<string>): (part: StreamPart) => StreamPart {
    const names = new Map<string, string>()
    const nameOf = (id: string): string => {
        const known = names.get(id)
        if (known) return known
        let name = id
        for (let n = 2; taken.has(name); n++) name = `${id}-${n}`
        taken.add(name)
        names.set(id, name)
        return name
    }
    return part => {
        if ('toolCallId' in part && typeof part.toolCallId === 'string') return { ...part, toolCallId: nameOf(part.toolCallId) }
        if ((part.type.startsWith('text-') || part.type.startsWith('reasoning-') || part.type.startsWith('tool-input-')) && 'id' in part && typeof part.id === 'string') return { ...part, id: nameOf(part.id) } as StreamPart
        return part
    }
}

function record(turn: ReturnType<typeof streamedTurn>, part: StreamPart): void {
    if (part.type === 'text-delta' || part.type === 'reasoning-delta') turn.add({ type: part.type, id: part.id, text: part.delta } as Parameters<typeof turn.add>[0])
    else if (part.type === 'tool-call') turn.add({ ...part, input: parsedInput(part.input) ?? {} } as Parameters<typeof turn.add>[0])
    else if (part.type === 'tool-result') turn.add({ ...part, output: part.result, providerExecuted: true } as Parameters<typeof turn.add>[0])
}

// What the model writes once told it carries on is a note to itself, whatever words it picks: one tells
// the user it hit a limit, which they were never to see. It goes to the next session and nowhere else,
// unless there is none.
function heldNote(budget: ScreenBudget) {
    const blocks = new Set<string>()
    let parts: StreamPart[] = []
    const release = (): StreamPart[] => {
        const released = parts
        parts = []
        blocks.clear()
        return released
    }
    return {
        release,
        pass: (part: StreamPart): StreamPart[] => {
            if (part.type === 'text-start' && budget.carriesOn()) blocks.add(part.id)
            if ((part.type === 'text-start' || part.type === 'text-delta' || part.type === 'text-end') && blocks.has(part.id)) {
                parts.push(part)
                return []
            }
            const speaksToTheUser = part.type === 'error' || ('toolName' in part && isHitlToolName(part.toolName))
            return speaksToTheUser ? [...release(), part] : [part]
        },
    }
}

// The result of a screen action names a picture the next session never saw.
function withoutPictureNames(message: ModelMessage): ModelMessage {
    if (message.role !== 'tool') return message
    return {
        ...message,
        content: message.content.map(part => {
            if (part.type !== 'tool-result' || !SCREEN_TOOLS.has(canonicalBridgeName(part.toolName)) || part.output.type !== 'json') return part
            const { status, reason } = (part.output.value ?? {}) as { status?: string; reason?: string }
            return { ...part, output: { type: 'json' as const, value: reason === undefined ? { status: status ?? 'done' } : { status: status ?? 'done', reason } } }
        }),
    }
}

// The CLIs read a tool's result back from a tool message only, and Codex writes the text of a message
// before its calls: cut at each result, the note that closes the stretch comes last, as it was written.
function workOf(turn: ModelMessage[]): ModelMessage[] {
    return repairToolPairs(withToolResultsInToolMessages(turn.map(withoutReasoning))).map(withoutPictureNames)
}

// The session a Codex thread id resumes holds the very pictures the new one is opened to leave behind.
function withoutThread(params: CallParams): CallParams {
    const codex = params.providerOptions?.['codex-app-server']
    if (!codex || !('threadId' in codex)) return params
    const { threadId: _threadId, ...kept } = codex
    return { ...params, providerOptions: { ...params.providerOptions, 'codex-app-server': kept } }
}

export type StretchOptions = {
    budget: ScreenBudget
    signal: AbortSignal
    /** Closes a session without waiting for one that hangs. */
    teardown: (close: () => Promise<void>) => Promise<unknown>
    /** Called with the session of the last stretch closed, before the next one opens. */
    betweenStretches: () => Promise<void>
    /** What the next session is told of the work so far, when all of it would not fit. */
    fit: (work: ModelMessage[]) => ModelMessage[]
}

/**
 * The model of a run on a CLI, which carries on past the screenshots one session may hold. To the loop
 * it is one call: the new session's answer streams on in the same one, with the usage of both.
 */
export function acrossScreenStretches(open: () => ResolvedModel, { budget, signal, teardown, betweenStretches, fit }: StretchOptions): ResolvedModel {
    let current = open()
    let closed = false
    const over = () => closed || signal.aborted

    async function* stretches(first: StreamResult, params: CallParams): AsyncGenerator<StreamPart> {
        const taken = new Set<string>()
        let work: ModelMessage[] = []
        let usage: Usage | undefined
        let stream = first.stream
        for (let stretch = 0; ; stretch++) {
            const turn = streamedTurn()
            const rename = renamer(taken)
            const note = heldNote(budget)
            let finish: FinishPart | undefined
            let held = false
            try {
                for await (const raw of stream as unknown as AsyncIterable<StreamPart>) {
                    if (stretch > 0 && raw.type === 'stream-start') continue
                    const part = rename(raw)
                    record(turn, part)
                    if (part.type !== 'finish') {
                        yield* note.pass(part)
                        continue
                    }
                    usage = addUsage(usage, part.usage)
                    finish = { ...part, usage }
                    held = budget.carriesOn()
                    if (!held) yield finish
                }
            } catch (error) {
                yield* note.release()
                throw error
            }
            if (!finish || !held) {
                yield* note.release()
                return
            }
            const messages = turn.messages()
            if (finish.finishReason.unified !== 'stop' || over() || findPendingHitl(messages)) {
                yield* note.release()
                yield finish
                return
            }
            work = [...work, ...workOf(messages), { role: 'user', content: [{ type: 'text', text: CARRY_ON_NOTE }] }]
            budget.nextStretch()
            try {
                await teardown(() => current.close())
                await betweenStretches()
                if (over()) {
                    yield* note.release()
                    yield finish
                    return
                }
                current = open()
                const next = await current.model.doStream({ ...withoutThread(params), prompt: [...params.prompt, ...(fit(work) as CallParams['prompt'])] })
                stream = next.stream
            } catch (error) {
                yield* note.release()
                yield { type: 'error', error }
                return
            }
        }
    }

    const middleware: LanguageModelMiddleware = {
        specificationVersion: 'v3',
        async wrapStream({ doStream, params }) {
            const first = await doStream()
            const parts = stretches(first, params)
            return {
                ...first,
                stream: new ReadableStream<StreamPart>({
                    async pull(controller) {
                        const { done, value } = await parts.next()
                        if (done) controller.close()
                        else controller.enqueue(value)
                    },
                    cancel: () => void parts.return(undefined),
                }),
            }
        },
    }

    return {
        model: wrapLanguageModel({ model: current.model, middleware }),
        close: async () => {
            closed = true
            await current.close()
        },
        contextUsage: () => current.contextUsage?.(),
        quickReplies: () => current.quickReplies(),
    }
}
