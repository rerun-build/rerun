'use client'

import { ARCHIVE_RETENTION_DAYS } from '@/lib/archive/retention'
import { isMachineEntitled } from '@rerun/cloud/billing'
import { useSandboxArchiveStore } from '@/stores/sandbox-archive.store'
import { useSession } from '@/supabase/session/SessionProvider'
import { useTranslations } from 'next-intl'

// `paused`: the plan ended and the machine was archived away; the board still draws every agent,
// locked. `restoring`: the workspace pays again and its archive is on its way back to a machine.
export type WorkspaceAccess = 'live' | 'paused' | 'restoring'

const DAY_MS = 86_400_000

type WorkspaceAccessState = {
    access: WorkspaceAccess
    keptUntil: Date | null
    needsMachineReason: string | null
    paymentFailed: boolean
    // A sandbox archived for inactivity: it comes back through a request to us, not a payment.
    sandboxArchived: boolean
}

const LIVE: WorkspaceAccessState = { access: 'live', keptUntil: null, needsMachineReason: null, paymentFailed: false, sandboxArchived: false }

// `needsMachineReason` is what a control that needs the machine says while it is disabled.
// `paymentFailed`: paused over a declined charge, with the subscription still there to be paid.
export function useWorkspaceAccess(): WorkspaceAccessState {
    const { workspace } = useSession()
    const sandboxArchive = useSandboxArchiveStore(s => (workspace && s.workspaceId === workspace.id ? s.archive : null))
    const archivedAt = workspace?.boxes_archived_at ?? null
    const t = useTranslations('workspace.access')
    if (!workspace) return LIVE

    // A sandbox sits on a plan that never ends, so its plan says nothing: only the server knows
    // whether it is waiting on an approval or already on its way back. Until it has answered, an
    // archived sandbox reads as archived, which is what it nearly always is.
    if (workspace.is_sandbox) {
        if (!archivedAt && !sandboxArchive) return LIVE
        if (sandboxArchive?.status === 'restoring') return { ...LIVE, access: 'restoring', needsMachineReason: t('restoring') }
        const keptUntil = sandboxArchive?.keptUntil ? new Date(sandboxArchive.keptUntil) : archivedAt ? new Date(new Date(archivedAt).getTime() + ARCHIVE_RETENTION_DAYS * DAY_MS) : null
        return { access: 'paused', keptUntil, needsMachineReason: t('sandboxArchived'), paymentFailed: false, sandboxArchived: true }
    }

    if (!archivedAt) return LIVE

    const access = isMachineEntitled(workspace.subscription_status) ? 'restoring' : 'paused'
    const paymentFailed = workspace.subscription_status === 'past_due'
    const keptUntil = new Date(new Date(archivedAt).getTime() + ARCHIVE_RETENTION_DAYS * DAY_MS)
    return { access, keptUntil, needsMachineReason: paymentFailed ? t('paymentFailed') : t(access), paymentFailed, sandboxArchived: false }
}
