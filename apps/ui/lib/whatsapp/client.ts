import { DEFAULT_WHATSAPP_FROM } from '@moldwright/cloud/senders'
import { birdConfig } from '@/lib/bird/config'
import type { WhatsAppComponent, WhatsAppLanguage } from './templates'

function whatsappSender(): string | null {
    return process.env.BIRD_WHATSAPP_FROM || DEFAULT_WHATSAPP_FROM
}

export type WhatsAppSendFailure = 'rate_limited' | 'rejected' | 'unavailable'

export type SendWhatsAppResult = { ok: true; id: string } | { ok: true; id: null; skipped: true } | { ok: false; error: WhatsAppSendFailure; detail: string }

export type SendWhatsAppInput = {
    to: string
    slug: string
    language: WhatsAppLanguage
    components: WhatsAppComponent[]
    idempotencyKey: string
    tags?: { name: string; value: string }[]
    metadata?: Record<string, string>
}

type BirdBody = { id?: string; error?: { code?: string; type?: string; message?: string; request_id?: string } }

export function whatsappDestination(to: string): string | null {
    const redirect = process.env.WHATSAPP_REDIRECT_TO
    if (redirect) return redirect
    if (process.env.EMAIL_REDIRECT_TO || process.env.NODE_ENV !== 'production') return null
    return to
}

function failureOf(status: number): WhatsAppSendFailure {
    if (status === 429) return 'rate_limited'
    return status >= 500 ? 'unavailable' : 'rejected'
}

export async function sendWhatsAppTemplate(input: SendWhatsAppInput): Promise<SendWhatsAppResult> {
    const to = whatsappDestination(input.to)
    if (!to) {
        console.info(`[whatsapp] delivery is off here, ${input.slug} not sent to ${input.to}`)
        return { ok: true, id: null, skipped: true }
    }

    const config = birdConfig()
    if (!config) return { ok: false, error: 'unavailable', detail: 'BIRD_API_KEY is not set' }
    const from = whatsappSender()
    if (!from) return { ok: false, error: 'unavailable', detail: 'BIRD_WHATSAPP_FROM is not set' }

    try {
        const response = await fetch(`${config.baseUrl}/whatsapp/messages`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': input.idempotencyKey },
            body: JSON.stringify({
                to,
                from,
                template: { slug: input.slug, language: input.language, components: input.components },
                ...(input.tags ? { tags: input.tags } : {}),
                ...(input.metadata ? { metadata: input.metadata } : {}),
            }),
        })
        const body = (await response.json().catch(() => ({}))) as BirdBody
        if (response.status < 300 && body.id) return { ok: true, id: body.id }

        const detail = [response.status, body.error?.code ?? body.error?.type, body.error?.message, body.error?.request_id].filter(Boolean).join(' ')
        console.error(`[whatsapp] ${input.slug} refused`, detail)
        return { ok: false, error: failureOf(response.status), detail }
    } catch (error) {
        console.error(`[whatsapp] ${input.slug} failed`, error)
        return { ok: false, error: 'unavailable', detail: error instanceof Error ? error.message : 'request failed' }
    }
}
