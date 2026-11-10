import type { BoxAccess } from '@/lib/board/box-access'
import type { useTranslations } from 'next-intl'

type AccessSummaryInput = {
    isAdmin: boolean
    visibility: string | null | undefined
    access: BoxAccess
    // Rows of `space_members` on the Box. Only an admin reads every row, so a member's count would
    // be their own row at most: it is never shown to them.
    grantCount: number
    boxName: string
}

export type AccessSummary = { title: string; detail: string | null }

type AccessSummaryTranslator = ReturnType<typeof useTranslations<'agent.accessSummary'>>

function ownLevel(access: BoxAccess, t: AccessSummaryTranslator): string {
    return access === 'manage' ? t('youManage') : t('youCanUse')
}

export function coworkerAccessSummary({ isAdmin, visibility, access, grantCount, boxName }: AccessSummaryInput, t: AccessSummaryTranslator): AccessSummary {
    const via = t('viaBox', { box: boxName })
    if ((visibility ?? 'workspace') === 'workspace') return { title: t('everyone'), detail: isAdmin ? via : t(access === 'manage' ? 'youManageViaBox' : 'youCanUseViaBox', { box: boxName }) }
    if (!isAdmin) return { title: ownLevel(access, t), detail: via }
    if (grantCount === 0) return { title: t('adminsOnly'), detail: via }
    return { title: t('peopleViaBox', { count: grantCount, box: boxName }), detail: null }
}
