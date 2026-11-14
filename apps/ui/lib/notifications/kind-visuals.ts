import type { BorderBeamProps } from '@rerun/ui'
import type { NotificationKind } from '@/lib/engine/types'
import { AlertCircle, CheckCircle2, HelpCircle, Plug, ShieldCheck, TriangleAlertIcon, type LucideIcon } from '@/lib/icons'

export const KIND_ICONS: Record<NotificationKind, LucideIcon> = {
    done: CheckCircle2,
    error: AlertCircle,
    info: TriangleAlertIcon,
    question: HelpCircle,
    approval: ShieldCheck,
    connector: Plug,
}

export const KIND_ICON_COLORS: Record<NotificationKind, string> = {
    done: 'text-emerald-400',
    error: 'text-red-400',
    info: 'text-orange-400',
    question: 'text-cyan-400',
    approval: 'text-yellow-400',
    connector: 'text-teal-400',
}

export const KIND_BEAM: Record<NotificationKind, BorderBeamProps['tone']> = {
    done: 'white',
    error: 'red',
    info: 'orange',
    question: 'brand',
    approval: 'orange',
    connector: 'cyan',
}
