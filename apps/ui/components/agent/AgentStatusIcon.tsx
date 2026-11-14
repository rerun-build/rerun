import type { AgentStatus } from '@/lib/board/types'
import { AlertCircleIcon, CircleCheckIcon, CircleIcon, ClockIcon, LoaderIcon, MessageCircleQuestionIcon, PlugIcon, PowerOffIcon, ShieldCheckIcon, TriangleAlertIcon, type LucideIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'

const STATUS_ICONS: Record<string, LucideIcon> = {
    idle: CircleCheckIcon,
    working: LoaderIcon,
    error: AlertCircleIcon,
    offline: PowerOffIcon,
    waiting_human: ClockIcon,
    awaiting_question: MessageCircleQuestionIcon,
    awaiting_approval: ShieldCheckIcon,
    awaiting_connector: PlugIcon,
    awaiting_ack: TriangleAlertIcon,
}

export function AgentStatusIcon({ status, className }: { status: AgentStatus | string; className?: string }) {
    const Glyph = STATUS_ICONS[status] ?? CircleIcon
    return <Glyph className={cn('size-3.5 shrink-0 text-muted-foreground', status === 'working' && 'animate-spin', className)} />
}
