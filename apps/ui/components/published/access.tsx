'use client'

import { Badge, type BadgeTone } from '@rerun/ui/primitives'
import { useTranslations } from 'next-intl'

import { PUBLISHED_ACCESS_MODES, type PublishedAccess } from '@/lib/published/access'
import { GlobeIcon, KeyIcon, MailIcon, UsersIcon, type LucideIcon } from '@/lib/icons'
import { useSession } from '@/supabase/session/SessionProvider'

export const ACCESS_ORDER: readonly PublishedAccess[] = PUBLISHED_ACCESS_MODES

const ACCESS_META: Record<PublishedAccess, { icon: LucideIcon; tone: BadgeTone }> = {
    public: { icon: GlobeIcon, tone: 'green' },
    workspace: { icon: UsersIcon, tone: 'neutral' },
    password: { icon: KeyIcon, tone: 'orange' },
    invited: { icon: MailIcon, tone: 'cyan' },
}

export function AccessIcon({ access, className }: { access: PublishedAccess; className?: string }) {
    const Icon = ACCESS_META[access].icon
    return <Icon className={className} />
}

export function useAccessCopy() {
    const t = useTranslations('published.access')
    return {
        short: (access: PublishedAccess) => t(`short.${access}`),
        hint: (access: PublishedAccess) => t(`hint.${access}`),
        label: (access: PublishedAccess, workspaceName: string) => t(`label.${access}`, { workspace: workspaceName }),
        invite: (entry: string) => (entry.startsWith('@') ? t('anyoneAt', { domain: entry.slice(1) }) : entry),
    }
}

export function useWorkspaceName(): string {
    const t = useTranslations('published.access')
    const { workspace } = useSession()
    return workspace?.name || t('workspaceFallback')
}

export function AccessBadge({ access, size = 'xs' }: { access: PublishedAccess; size?: 'xs' | 'sm' }) {
    const t = useTranslations('published.access')
    const meta = ACCESS_META[access]
    const AccessIcon = meta.icon
    return (
        <Badge tone={meta.tone} size={size}>
            <AccessIcon className={size === 'xs' ? 'size-3' : 'size-3.5'} />
            {t(`short.${access}`)}
        </Badge>
    )
}
