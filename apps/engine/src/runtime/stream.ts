import { createUIMessageStream, createUIMessageStreamResponse, type UIMessageStreamWriter } from 'ai'
import { registerRunStream, subscribeRunStream } from './run-streams.js'

const HEARTBEAT_MS = 15_000

export function registerRun(runId: string, execute: (writer: UIMessageStreamWriter) => Promise<void>): Response {
    const stream = createUIMessageStream({
        execute: ({ writer }) => execute(writer),
        onError: error => (error instanceof Error ? error.message : String(error)),
    })
    const base = createUIMessageStreamResponse({ stream })
    if (base.body) registerRunStream(runId, base.body)
    return base
}

export function toResumableStreamResponse(runId: string, execute: (writer: UIMessageStreamWriter) => Promise<void>): Response {
    const base = registerRun(runId, execute)
    if (!base.body) return base
    const body = subscribeRunStream(runId) ?? base.body
    return new Response(withHeartbeat(body, HEARTBEAT_MS), { status: base.status, headers: base.headers })
}

export function resumeStreamResponse(runId: string): Response {
    const sub = subscribeRunStream(runId)
    if (!sub) return new Response(null, { status: 204 })
    const headers = new Headers()
    headers.set('content-type', 'text/event-stream')
    headers.set('x-vercel-ai-ui-message-stream', 'v1')
    return new Response(withHeartbeat(sub, HEARTBEAT_MS), { status: 200, headers })
}

function withHeartbeat(body: ReadableStream<Uint8Array>, intervalMs: number): ReadableStream<Uint8Array> {
    const ping = new TextEncoder().encode(': keepalive\n\n')
    const reader = body.getReader()
    let timer: ReturnType<typeof setInterval> | undefined
    return new ReadableStream<Uint8Array>({
        start(controller) {
            timer = setInterval(() => {
                try {
                    controller.enqueue(ping)
                } catch {
                    if (timer) clearInterval(timer)
                }
            }, intervalMs)
            ;(async () => {
                try {
                    while (true) {
                        const { done, value } = await reader.read()
                        if (done) break
                        controller.enqueue(value)
                    }
                    controller.close()
                } catch (err) {
                    controller.error(err)
                } finally {
                    if (timer) clearInterval(timer)
                }
            })()
        },
        cancel(reason) {
            if (timer) clearInterval(timer)
            return reader.cancel(reason)
        },
    })
}
