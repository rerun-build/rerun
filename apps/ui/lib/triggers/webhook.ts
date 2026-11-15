import { getAppOrigin } from '@/lib/app-origin'

export const MAX_TRIGGER_BODY_BYTES = 1_048_576

export async function readBodyCapped(req: Request, maxBytes: number): Promise<string | null> {
    if (Number(req.headers.get('content-length') ?? 0) > maxBytes) return null
    if (!req.body) return ''

    const reader = req.body.getReader()
    const decoder = new TextDecoder()
    let total = 0
    let text = ''
    try {
        for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
            total += chunk.value.byteLength
            if (total > maxBytes) break
            text += decoder.decode(chunk.value, { stream: true })
        }
    } catch {
        return ''
    }
    if (total > maxBytes) {
        await reader.cancel().catch(() => {})
        return null
    }
    return text + decoder.decode()
}

export async function triggerWebhookUrl(agentId: string, slug: string, token: string): Promise<string> {
    return `${await getAppOrigin()}/api/t/${agentId}/${slug}/${token}`
}
