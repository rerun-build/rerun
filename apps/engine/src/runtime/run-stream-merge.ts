import type { Usage } from '@rerun/contracts'
import type { LanguageModelUsage, UIMessageChunk, UIMessageStreamWriter } from 'ai'
import { QUICK_REPLIES_TOOL, withHitlVersion } from '@rerun/contracts'
import { canonicalHitlName, isHitlToolName } from '../tools/builtin/hitl.js'
import type { QuickRepliesCapture } from '../agents/quick-replies-stream.js'
import type { AgentRun, RunOutcome } from './loop.js'

// A settled run whose provider stream never closes would otherwise keep the SSE response and the
// replay buffer alive: the dashboard reconnects to a stream that will never emit again, and the
// message the user types next is dropped as a duplicate. The grace period lets the last chunks of a
// normal turn land before the cut.
const CUT_GRACE_MS = 2_000

const sum = (a: number | undefined, b: number | undefined): number | undefined =>
    a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0)

const addUsage = (a: Usage | undefined, b: LanguageModelUsage): Usage => ({
    inputTokens: sum(a?.inputTokens, b.inputTokens),
    outputTokens: sum(a?.outputTokens, b.outputTokens),
    totalTokens: sum(a?.totalTokens, b.totalTokens),
    reasoningTokens: sum(a?.reasoningTokens, b.reasoningTokens),
    cachedInputTokens: sum(a?.cachedInputTokens, b.cachedInputTokens),
})

function normalizeHitlStream(stream: ReadableStream<UIMessageChunk>): ReadableStream<UIMessageChunk> {
    return stream.pipeThrough(
        new TransformStream<UIMessageChunk, UIMessageChunk>({
            transform(chunk, controller) {
                const c = chunk as { type?: string; toolName?: string; input?: unknown }
                if (c.type === 'tool-input-start' && isHitlToolName(c.toolName)) {
                    controller.enqueue({ ...chunk, toolName: canonicalHitlName(c.toolName) } as UIMessageChunk)
                    return
                }
                if (c.type === 'tool-input-available' && isHitlToolName(c.toolName)) {
                    const toolName = canonicalHitlName(c.toolName)
                    controller.enqueue({ ...chunk, toolName, input: withHitlVersion(toolName, c.input) } as UIMessageChunk)
                    return
                }
                controller.enqueue(chunk)
            },
        }),
    )
}

// The replies the model closed its message with reach the chat as the call the old tool made, right
// before the stream ends: by then the last text block went through the cut, so the capture is whole.
export function withQuickReplies(stream: ReadableStream<UIMessageChunk>, read: (() => QuickRepliesCapture | undefined) | undefined): ReadableStream<UIMessageChunk> {
    if (!read) return stream
    return stream.pipeThrough(
        new TransformStream<UIMessageChunk, UIMessageChunk>({
            transform(chunk, controller) {
                if (chunk.type === 'finish') {
                    const capture = read()
                    if (capture) controller.enqueue({ type: 'tool-input-available', toolCallId: capture.toolCallId, toolName: QUICK_REPLIES_TOOL, input: { replies: capture.replies } })
                }
                controller.enqueue(chunk)
            },
        }),
    )
}

const isCleanFinish = (finishReason: string | undefined): boolean => finishReason === undefined || finishReason === 'stop' || finishReason === 'tool-calls'

export function cutOffWhenSettled(body: ReadableStream<UIMessageChunk>, settled: Promise<RunOutcome>): ReadableStream<UIMessageChunk> {
    const reader = body.getReader()
    let cutTimer: ReturnType<typeof setTimeout> | undefined
    let closed = false
    return new ReadableStream<UIMessageChunk>({
        start(controller) {
            const finish = (outcome?: RunOutcome): void => {
                if (closed) return
                closed = true
                if (outcome?.kind === 'error') controller.enqueue({ type: 'error', errorText: outcome.error ?? 'The run failed.' })
                try {
                    controller.close()
                } catch {
                    // The consumer already went away.
                }
                void reader.cancel().catch(() => {})
            }
            // A run that reached `done` produced its finish part, so its stream closes on its own:
            // cutting it would truncate the tail of a perfectly good answer.
            void settled.then(outcome => {
                if (outcome.kind === 'done' || closed) return
                cutTimer = setTimeout(() => finish(outcome), CUT_GRACE_MS)
            })
            void (async () => {
                let endedCleanly = false
                try {
                    while (true) {
                        const { done, value } = await reader.read()
                        if (done || closed) break
                        if (value.type === 'finish') endedCleanly = isCleanFinish(value.finishReason)
                        controller.enqueue(value)
                    }
                } catch {
                    // Fall through: the run's own outcome is what the client needs, not this read error.
                } finally {
                    if (cutTimer) clearTimeout(cutTimer)
                    // Codex fails a turn by erroring its stream, not with an error part: closing here
                    // would leave the chat on an empty answer with no reason given.
                    if (endedCleanly || closed) finish()
                    else void settled.then(finish)
                }
            })()
        },
        cancel(reason) {
            closed = true
            if (cutTimer) clearTimeout(cutTimer)
            return reader.cancel(reason)
        },
    })
}

export function mergeRunStream(writer: UIMessageStreamWriter, run: AgentRun, meta: { provider: string; model: string }): void {
    writer.merge(
        cutOffWhenSettled(
            withQuickReplies(
                normalizeHitlStream(
                    run.result.toUIMessageStream({
                        messageMetadata: ({ part }) => {
                            if (part.type === 'finish-step') {
                                const usage = addUsage(undefined, part.usage)
                                const context = run.contextUsage?.()
                                return { ...meta, usage: context ? { ...usage, context } : usage }
                            }
                            return undefined
                        },
                    }),
                ),
                run.quickReplies,
            ),
            run.settled,
        ),
    )
}
