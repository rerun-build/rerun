import type { AccessLevel, SpaceVisibility } from '@/app/api/_auth/access'
import type { BoxScope } from '@/app/api/_auth/box-scope'
import { UNNAMED } from '@/hooks/useMemberProfiles'
import type { AuthorProfile } from '@/lib/chat/message-author'
import { useTranslations } from 'next-intl'

// A person as the access dialogs print them: their name when the directory has one, else their email.
export function personLabel(profile: AuthorProfile | null, email: string | null, fallback = 'Teammate'): { title: string; email: string | null; named: boolean } {
    const name = profile?.name && profile.name !== UNNAMED ? profile.name : null
    return { title: name ?? email ?? fallback, email, named: !!name }
}

export const asIs = (path: string) => path

export const BOX_ACCESS_ADMIN_ONLY = 'Only an admin can change who can access a Box'

type RemovalOutcome = 'admin' | 'restricted' | 'manage' | 'use'

// What a change of access does to the person, as the confirmation dialogs print it.
function removalOutcomeKey(visibility: SpaceVisibility, access: AccessLevel, isAdmin: boolean): RemovalOutcome {
    if (isAdmin) return 'admin'
    if (visibility === 'restricted') return 'restricted'
    return access === 'manage' ? 'manage' : 'use'
}

// False when dropping the grant costs them nothing: the Box stays open to everyone and they still see it.
function levelOutcomeApplies(box: { visibility: SpaceVisibility }, boxScope: BoxScope): boolean {
    return box.visibility === 'restricted' || boxScope !== 'all'
}

export function useBoxAccessCopy() {
    const t = useTranslations('dialogs.boxAccess')
    return {
        teammate: t('teammate'),
        adminOnly: t('adminOnly'),
        adminsAlways: t('adminsAlways'),
        manageReason: t('manageReason'),
        removalOutcome: (visibility: SpaceVisibility, access: AccessLevel, isAdmin: boolean) => t(`outcome.${removalOutcomeKey(visibility, access, isAdmin)}`),
        scopeOutcome: t('outcome.scope'),
        levelOutcome: (box: { visibility: SpaceVisibility }, boxScope: BoxScope) => (levelOutcomeApplies(box, boxScope) ? t('outcome.level') : null),
    }
}
