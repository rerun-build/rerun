'use client'

import { Badge, type BadgeTone } from '@rerun/ui/primitives'

import { PUBLISHED_ACCESS_MODES, type PublishedAccess } from '@/lib/published/access'
import { GlobeIcon, KeyIcon, MailIcon, UsersIcon, type LucideIcon } from '@/lib/icons'
import { useSession } from '@/supabase/session/SessionProvider'

export const ACCESS_ORDER: readonly PublishedAccess[] = PUBLISHED_ACCESS_MODES

const ACCESS_META: Record<PublishedAccess, { short: string; icon: LucideIcon; tone: BadgeTone }> = {
    public: { short: 'Public', icon: GlobeIcon, tone: 'green' },
    workspace: { short: 'Workspace', icon: UsersIcon, tone: 'neutral' },
    password: { short: 'Password', icon: KeyIcon, tone: 'orange' },
    invited: { short: 'Invited', icon: MailIcon, tone: 'cyan' },
}

export const ACCESS_HINT: Record<PublishedAccess, string> = {
    public: 'No sign-in needed',
    workspace: 'Signed-in members only',
    password: 'Visitors type it once',
    invited: 'Visitors confirm their email',
}

export function AccessIcon({ access, className }: { access: PublishedAccess; className?: string }) {
    const Icon = ACCESS_META[access].icon
    return <Icon className={className} />
}

export function accessShort(access: PublishedAccess): string {
    return ACCESS_META[access].short
}

export function accessLabel(access: PublishedAccess, workspaceName: string): string {
    switch (access) {
        case 'public':
            return 'Anyone with the link'
        case 'workspace':
            return `${workspaceName} members`
        case 'password':
            return 'Anyone with the password'
        case 'invited':
            return 'Only people you invite'
    }
}

export function useWorkspaceName(): string {
    const { workspace } = useSession()
    return workspace?.name || 'Workspace'
}

export function inviteLabel(entry: string): string {
    return entry.startsWith('@') ? `Anyone at ${entry.slice(1)}` : entry
}

export function AccessBadge({ access, size = 'xs' }: { access: PublishedAccess; size?: 'xs' | 'sm' }) {
    const meta = ACCESS_META[access]
    const AccessIcon = meta.icon
    return (
        <Badge tone={meta.tone} size={size}>
            <AccessIcon className={size === 'xs' ? 'size-3' : 'size-3.5'} />
            {meta.short}
        </Badge>
    )
}
