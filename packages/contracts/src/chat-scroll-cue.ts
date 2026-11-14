import { pendingApprovals, pendingMcpSignIn, pendingQuestions, pendingSecrets, pendingServices, type HitlKind } from './chat-hitl.js'

export type HitlCueCopy = (key: 'question' | 'approval' | 'secret' | 'mcpNamed' | 'mcp' | 'service' | 'takeover', values?: Record<string, string | number>) => string

export function pendingHitlLabel(kind: HitlKind, input: Record<string, unknown>, t: HitlCueCopy): string {
    switch (kind) {
        case 'question':
            return t('question', { count: pendingQuestions(input).length })
        case 'approval':
            return t('approval', { count: pendingApprovals(input).length })
        case 'secret':
            return t('secret', { count: pendingSecrets(input).length })
        case 'mcp': {
            const { name } = pendingMcpSignIn(input)
            return name ? t('mcpNamed', { name }) : t('mcp')
        }
        case 'service':
            return t('service', { count: pendingServices(input).length })
        case 'takeover':
            return t('takeover')
    }
}

export type ScrollCue = 'pill' | 'arrow' | null

export function scrollCueOf({ pending, pendingInView, atBottom }: { pending: boolean; pendingInView: boolean; atBottom: boolean }): ScrollCue {
    if (pending) return pendingInView || atBottom ? null : 'pill'
    return atBottom ? null : 'arrow'
}
