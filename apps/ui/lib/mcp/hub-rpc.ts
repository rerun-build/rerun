export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05', '2024-10-07']

export const DEFAULT_PROTOCOL_VERSION = '2025-06-18'

export type RpcRequest = { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown> }

export function negotiatedProtocolVersion(requested: unknown): string {
    return typeof requested === 'string' && SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : DEFAULT_PROTOCOL_VERSION
}

export function rpcResult(id: unknown, result: unknown): Response {
    return Response.json({ jsonrpc: '2.0', id, result })
}

export function rpcError(id: unknown, code: number, message: string): Response {
    return Response.json({ jsonrpc: '2.0', id, error: { code, message } })
}

export function toolError(id: unknown, message: string): Response {
    return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify({ error: message }) }], isError: true })
}

export function toolResult(id: unknown, data: unknown): Response {
    return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify(data) }] })
}
