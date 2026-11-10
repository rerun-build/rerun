import { pendingApprovals, pendingMcpSignIn, pendingQuestions, pendingSecrets, pendingServices, pendingTakeover, type HitlKind } from '@rerun/contracts'
import type { useTranslations } from 'use-intl'

import type { IconName } from '@/components/ui/Icon'


type HitlTranslator = ReturnType<typeof useTranslations<'mobileHitl'>>

const SYMBOLS: Record<HitlKind, IconName> = { question: 'message-circle-question', approval: 'shield-check', secret: 'lock', mcp: 'link', service: 'link', takeover: 'monitor' }

// What is waiting at the end of the thread, the web's words (`pendingHitlLabel`) in the app's language.
function pendingLabel(kind: HitlKind, input: Record<string, unknown>, t: HitlTranslator): string {
    switch (kind) {
        case 'question':
            return t('pending.question', { count: pendingQuestions(input).length })
        case 'approval':
            return t('pending.approval', { count: pendingApprovals(input).length })
        case 'secret':
            return t('pending.secret', { count: pendingSecrets(input).length })
        case 'mcp': {
            const { name } = pendingMcpSignIn(input)
            return name ? t('pending.mcpNamed', { name }) : t('pending.mcp')
        }
        case 'service':
            return t('pending.service', { count: pendingServices(input).length })
        case 'takeover':
            return t('pending.takeover')
    }
}

// The web's cue for a pending block, with the system's symbols.
export function summarizePendingHitl(kind: HitlKind, input: Record<string, unknown>, t: HitlTranslator): { symbol: IconName; label: string } {
    return { symbol: SYMBOLS[kind], label: pendingLabel(kind, input, t) }
}

const textOf = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null)

// The first thing the block asks, to read in the chat when the app cannot draw the block itself.
export function firstAsk(kind: HitlKind, input: Record<string, unknown>): string | null {
    switch (kind) {
        case 'question':
            return pendingQuestions(input)[0]?.question ?? null
        case 'approval':
            return pendingApprovals(input)[0]?.action ?? null
        case 'secret':
            return pendingSecrets(input)[0]?.label ?? null
        case 'service':
            return textOf(pendingServices(input)[0]?.reason)
        case 'mcp':
            return textOf(pendingMcpSignIn(input).reason)
        case 'takeover':
            return textOf(pendingTakeover(input).reason)
    }
}

const ASK_KEYS = ['question', 'message', 'reason', 'purpose', 'action', 'prompt', 'title', 'description']

// What a call the app has no name for asks, from the keys a HITL input usually says it with.
export function askOf(input: Record<string, unknown>): string | null {
    for (const key of ASK_KEYS) {
        const text = textOf(input[key])
        if (text) return text
    }
    return null
}
