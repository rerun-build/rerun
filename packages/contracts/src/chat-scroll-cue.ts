import { pendingApprovals, pendingMcpSignIn, pendingQuestions, pendingSecrets, pendingServices, type HitlKind } from './chat-hitl.js'

// The `chat.hitlCue` namespace, in the reader's language.
export type HitlCueCopy = (key: 'question' | 'approval' | 'secret' | 'mcpNamed' | 'mcp' | 'service' | 'takeover', values?: Record<string, string | number>) => string

// What the scroll cue says is waiting at the end of the thread, once the block is out of sight. Each
// client draws its own glyph beside it.
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

// While a block waits, the round arrow never shows: once the block is in sight it would sit right
// on its buttons, the thread having been unstuck to bring a tall block in by its top. Nor does the pill
// at the bottom: a block just mounted reads out of sight while the thread is still following it in.
export function scrollCueOf({ pending, pendingInView, atBottom }: { pending: boolean; pendingInView: boolean; atBottom: boolean }): ScrollCue {
    if (pending) return pendingInView || atBottom ? null : 'pill'
    return atBottom ? null : 'arrow'
}
