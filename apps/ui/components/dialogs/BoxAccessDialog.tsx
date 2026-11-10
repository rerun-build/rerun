'use client'

import { useErrorText } from '@/hooks/useErrorText'
import type { AccessLevel, SpaceVisibility } from '@/app/api/_auth/access'
import { getSpaceAccessAction, grantSpaceAccessAction, revokeSpaceAccessAction, setSpaceVisibilityAction, type SpaceAccessView } from '@/app/api/_actions/space-access.actions'
import { BoxAccessView } from '@/components/dialogs/BoxAccessView'
import { PanelDialogContent } from '@/components/dialogs/PanelDialogContent'
import { Dialog } from '@/components/ui/dialog'
import { useMemberDirectory } from '@/hooks/useMemberProfiles'
import { syncBoardGrants, syncBoardVisibility } from '@/lib/board/sync-space-access'
import { useSession } from '@/supabase/session/SessionProvider'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

type Result = { ok: true } | { ok: false; error: string }

// Who can use a Box, and so every coworker in it. Admin only: the menu that opens it is disabled for
// a member, and every action refuses one anyway.
export function BoxAccessDialog({ spaceId, boxName, open, onOpenChange }: { spaceId: string | null; boxName?: string | null; open: boolean; onOpenChange: (open: boolean) => void }) {
    const t = useTranslations('dialogs.boxAccess')
    const errorText = useErrorText()
    const [access, setAccess] = useState<SpaceAccessView | null>(null)
    const [loading, setLoading] = useState(true)
    const [busy, setBusy] = useState(false)
    const { workspace } = useSession()
    const profileOf = useMemberDirectory(workspace?.id)

    const refresh = useCallback(async () => {
        if (!spaceId) return
        const result = await getSpaceAccessAction(spaceId)
        setLoading(false)
        if (!result.ok) {
            toast.error(errorText(result))
            return
        }
        setAccess(result)
        syncBoardVisibility(result.spaceId, result.visibility)
        syncBoardGrants(result.spaceId, result.people)
    }, [spaceId, errorText])

    useEffect(() => {
        if (!open || !spaceId) return
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setLoading(true)
        setAccess(null)
        void refresh()
    }, [open, spaceId, refresh])

    const run = async (action: (id: string) => Promise<Result>): Promise<boolean> => {
        if (busy || !spaceId) return false
        setBusy(true)
        const result = await action(spaceId)
        if (!result.ok) toast.error(errorText(result))
        await refresh()
        setBusy(false)
        return result.ok
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <PanelDialogContent className="sm:h-[min(36rem,88dvh)] sm:max-w-lg">
                <BoxAccessView
                    key={spaceId ?? 'none'}
                    boxName={access?.name || boxName || t('unnamedBox')}
                    loading={loading}
                    access={access}
                    busy={busy}
                    profileOf={profileOf}
                    onVisibilityChange={(visibility: SpaceVisibility) => void run(id => setSpaceVisibilityAction(id, visibility))}
                    onAccessChange={(userId, level: AccessLevel) => void run(id => grantSpaceAccessAction(id, [userId], level))}
                    onRemove={userId => void run(id => revokeSpaceAccessAction(id, userId))}
                    onAdd={(userIds, level) => run(id => grantSpaceAccessAction(id, userIds, level))}
                />
            </PanelDialogContent>
        </Dialog>
    )
}
