import { pendingHitlLabel, type HitlCueCopy, type HitlKind } from '@rerun/contracts'
import { LockIcon, MessageCircleQuestionIcon, MonitorIcon, PlugIcon, PlugSparkleIcon, ShieldAlertIcon, type LucideIcon } from '@/lib/icons'

export type PendingHitlSummary = {
    icon: LucideIcon
    tone: string
    label: string
}

const QUESTION_TONE = 'text-primary bg-primary/10'
const DECISION_TONE = 'text-orange-500 bg-orange-500/10'
const NEUTRAL_TONE = 'text-foreground bg-muted'

const ICONS: Record<HitlKind, { icon: LucideIcon; tone: string }> = {
    question: { icon: MessageCircleQuestionIcon, tone: QUESTION_TONE },
    approval: { icon: ShieldAlertIcon, tone: DECISION_TONE },
    secret: { icon: LockIcon, tone: NEUTRAL_TONE },
    mcp: { icon: PlugIcon, tone: NEUTRAL_TONE },
    service: { icon: PlugSparkleIcon, tone: NEUTRAL_TONE },
    takeover: { icon: MonitorIcon, tone: NEUTRAL_TONE },
}

// What the scroll cue says is waiting at the end of the thread, once the block is out of sight.
export function summarizePendingHitl(kind: HitlKind, input: Record<string, unknown>, t: HitlCueCopy): PendingHitlSummary {
    return { ...ICONS[kind], label: pendingHitlLabel(kind, input, t) }
}

export { scrollCueOf, type ScrollCue } from '@rerun/contracts'
