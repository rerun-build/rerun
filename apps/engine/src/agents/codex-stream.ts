import { modelContextWindow, type ContextOccupancy } from '@rerun/contracts'
import type { LanguageModelMiddleware } from 'ai'
import { canonicalBridgeName } from '../tools/builtin/hitl.js'

type WrapStream = NonNullable<LanguageModelMiddleware['wrapStream']>
type StreamResult = Awaited<ReturnType<Parameters<WrapStream>[0]['doStream']>>
type StreamPart = StreamResult['stream'] extends ReadableStream<infer Part> ? Part : never
type WrapGenerate = NonNullable<LanguageModelMiddleware['wrapGenerate']>
type GenerateResult = Awaited<ReturnType<Parameters<WrapGenerate>[0]['doGenerate']>>
type GeneratePart = GenerateResult['content'][number]

type McpToolCallEnvelope = {
    type: string
    arguments?: unknown
    result?: unknown
}

function record(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function mcpEnvelope(value: unknown): McpToolCallEnvelope | null {
    const item = record(value)
    if (!item || typeof item.type !== 'string' || item.type.replace(/[^a-z]/gi, '').toLowerCase() !== 'mcptoolcall') return null
    return item as McpToolCallEnvelope
}

function parseJson(value: string): unknown {
    try {
        return JSON.parse(value)
    } catch {
        return undefined
    }
}

function normalizeToolInput(input: string): string {
    const envelope = mcpEnvelope(parseJson(input))
    return envelope ? JSON.stringify(envelope.arguments ?? {}) : input
}

function unwrapMcpResult(value: unknown): unknown {
    const result = record(value)
    if (!result) return value ?? {}
    if (result.structuredContent !== null && result.structuredContent !== undefined) return result.structuredContent

    const content = result.content
    if (!Array.isArray(content) || content.length !== 1) return value
    const only = record(content[0])
    if (!only || only.type !== 'text' || typeof only.text !== 'string') return value
    const parsed = parseJson(only.text)
    return parsed === undefined || parsed === null ? only.text : parsed
}

function normalizeToolResult(result: unknown): unknown {
    const envelope = mcpEnvelope(result)
    return envelope ? unwrapMcpResult(envelope.result ?? {}) : result
}

function normalizeToolName(name: unknown): unknown {
    return typeof name === 'string' ? canonicalBridgeName(name) : name
}

export function normalizeCodexStreamPart(part: StreamPart): StreamPart {
    const item = part as StreamPart & { type: string; toolName?: string; delta?: string; input?: string; result?: unknown; preliminary?: boolean }
    if (item.type === 'tool-input-start') return { ...part, toolName: normalizeToolName(item.toolName) } as StreamPart
    if (item.type === 'tool-input-delta' && typeof item.delta === 'string') return { ...part, delta: normalizeToolInput(item.delta) } as StreamPart
    if (item.type === 'tool-call' && typeof item.input === 'string') {
        return { ...part, toolName: normalizeToolName(item.toolName), input: normalizeToolInput(item.input) } as StreamPart
    }
    if (item.type === 'tool-result') {
        return {
            ...part,
            toolName: normalizeToolName(item.toolName),
            result: item.preliminary ? item.result : normalizeToolResult(item.result),
        } as StreamPart
    }
    return part
}

export function normalizeCodexGeneratePart(part: GeneratePart): GeneratePart {
    const item = part as GeneratePart & { type: string; toolName?: string; input?: string; result?: unknown; preliminary?: boolean }
    if (item.type === 'tool-call' && typeof item.input === 'string') {
        return { ...part, toolName: normalizeToolName(item.toolName), input: normalizeToolInput(item.input) } as GeneratePart
    }
    if (item.type === 'tool-result') {
        return {
            ...part,
            toolName: normalizeToolName(item.toolName),
            result: item.preliminary ? item.result : normalizeToolResult(item.result),
        } as GeneratePart
    }
    return part
}

export const codexMcpCompatibilityMiddleware: LanguageModelMiddleware = {
    specificationVersion: 'v3',
    async wrapStream({ doStream }) {
        const result = await doStream()
        return {
            ...result,
            stream: result.stream.pipeThrough(
                new TransformStream<StreamPart, StreamPart>({
                    transform(part, controller) {
                        controller.enqueue(normalizeCodexStreamPart(part))
                    },
                }),
            ),
        }
    },
    async wrapGenerate({ doGenerate }) {
        const result = await doGenerate()
        return { ...result, content: result.content.map(normalizeCodexGeneratePart) }
    },
}

export type CodexContextCapture = { middleware: LanguageModelMiddleware; read: () => ContextOccupancy | undefined }

// A Codex turn is one step to the loop, and its usage adds up every model call the turn made, which
// is what it costs (see the provider patch). How full the window is lives in `usage.raw`, the latest
// of those calls: the turn's sum over a tool-heavy turn reads as several times the window.
export function codexContextCapture(model: string): CodexContextCapture {
    let snapshot: ContextOccupancy | undefined
    const maxTokens = modelContextWindow(model, 'codex')

    const capture = (part: StreamPart): void => {
        if (part.type !== 'finish' || !maxTokens) return
        const latestCall = record(part.usage.raw)
        if (typeof latestCall?.inputTokens !== 'number' || typeof latestCall.outputTokens !== 'number') return
        snapshot = { usedTokens: latestCall.inputTokens + latestCall.outputTokens, maxTokens }
    }

    return {
        read: () => snapshot,
        middleware: {
            specificationVersion: 'v3',
            async wrapStream({ doStream }) {
                const result = await doStream()
                return {
                    ...result,
                    stream: result.stream.pipeThrough(
                        new TransformStream<StreamPart, StreamPart>({
                            transform(part, controller) {
                                capture(part)
                                controller.enqueue(part)
                            },
                        }),
                    ),
                }
            },
        },
    }
}
