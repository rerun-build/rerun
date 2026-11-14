import { AlertCircleIcon, CheckCircle2Icon, HelpCircleIcon, ShieldCheckIcon, TriangleAlertIcon, type LucideIcon } from '../icons'
import type { BorderBeamProps } from '../BorderBeam'
import type { BadgeTone } from '../primitives/badge'

export const ATTENTION_STATUS_META: Record<string, { label: string; icon: LucideIcon; color: string; tint: string; tone: BadgeTone; beam: NonNullable<BorderBeamProps['tone']> }> = {
    error: { label: 'Error', icon: AlertCircleIcon, color: 'text-red-400', tint: 'border-red-400/20 bg-red-400/10 text-red-400', tone: 'red', beam: 'red' },
    awaiting_question: { label: 'Question', icon: HelpCircleIcon, color: 'text-cyan-400', tint: 'border-cyan-400/20 bg-cyan-400/10 text-cyan-400', tone: 'cyan', beam: 'cyan' },
    awaiting_approval: { label: 'Approval', icon: ShieldCheckIcon, color: 'text-yellow-400', tint: 'border-yellow-400/20 bg-yellow-400/10 text-yellow-400', tone: 'yellow', beam: 'yellow' },
    awaiting_ack: { label: 'Unread', icon: TriangleAlertIcon, color: 'text-orange-400', tint: 'border-orange-400/20 bg-orange-400/10 text-orange-400', tone: 'orange', beam: 'orange' },
    done: { label: 'Finished', icon: CheckCircle2Icon, color: 'text-emerald-400', tint: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-400', tone: 'green', beam: 'green' },
    waiting_human: { label: 'Waiting', icon: HelpCircleIcon, color: 'text-cyan-400', tint: 'border-cyan-400/20 bg-cyan-400/10 text-cyan-400', tone: 'cyan', beam: 'cyan' },
}
