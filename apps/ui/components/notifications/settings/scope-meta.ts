import { Bell, BellOff, BellRing, UserCheck, UsersIcon, type LucideIcon } from '@/lib/icons'
import type { CoworkerMode, NotificationScope } from '@/lib/notifications/prefs'

export const SCOPE_META: Record<NotificationScope, { icon: LucideIcon }> = {
    everything: { icon: UsersIcon },
    mine: { icon: UserCheck },
    needed: { icon: Bell },
    nothing: { icon: BellOff },
}

export const COWORKER_MODE_META: Record<CoworkerMode, { icon: LucideIcon }> = {
    default: { icon: Bell },
    everything: { icon: BellRing },
    muted: { icon: BellOff },
}
