'use client'

import { useErrorText } from '@/hooks/useErrorText'
import {
    inviteToWorkspaceAction,
    listWorkspaceMembersAction,
    removeMemberAction,
    revokeInvitationAction,
    setMemberBoxScopeAction,
    setMemberRoleAction,
    type WorkspaceInviteRow,
    type WorkspaceMember,
} from '@/app/api/_actions/members.actions'
import { grantSpaceAccessAction, listMemberAccessAction, revokeSpaceAccessAction, setSpaceVisibilityAction, type MemberBoxAccess } from '@/app/api/_actions/space-access.actions'
import type { BoxAccess } from '@/app/api/_auth/access'
import type { BoxScope } from '@/app/api/_auth/box-scope'
import { PanelDialogContent } from '@/components/dialogs/PanelDialogContent'
import { WorkspaceMembersView, type OpenedMember } from '@/components/dialogs/WorkspaceMembersView'
import { Dialog } from '@/components/ui/dialog'
import { useMemberDirectory } from '@/hooks/useMemberProfiles'
import { syncBoardGrant, syncBoardVisibility } from '@/lib/board/sync-space-access'
import { useSession, type WorkspaceRole } from '@/supabase/session/SessionProvider'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

type Result = { ok: true } | { ok: false; error: string }

export function WorkspaceMembersDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
    const t = useTranslations('dialogs.members')
    const errorText = useErrorText()
    const [members, setMembers] = useState<WorkspaceMember[]>([])
    const [inviteLink, setInviteLink] = useState<{ email: string; url: string } | null>(null)
    const [invites, setInvites] = useState<WorkspaceInviteRow[]>([])
    const [currentUserId, setCurrentUserId] = useState<string | null>(null)
    const [currentRole, setCurrentRole] = useState<WorkspaceRole | null>(null)
    const [loading, setLoading] = useState(true)
    const [busy, setBusy] = useState(false)
    const [opened, setOpened] = useState<OpenedMember | null>(null)
    const { workspace } = useSession()
    const profileOf = useMemberDirectory(workspace?.id)

    const refresh = useCallback(async () => {
        const result = await listWorkspaceMembersAction()
        if (!result.ok) {
            toast.error(errorText(result))
            setLoading(false)
            return
        }
        setMembers(result.members)
        setInvites(result.invites)
        setCurrentUserId(result.currentUserId)
        setCurrentRole(result.currentRole)
        setLoading(false)
    }, [errorText])

    useEffect(() => {
        if (!open) return
        refresh()
    }, [open, refresh])

    const loadAccess = useCallback(async (member: WorkspaceMember) => {
        const result = await listMemberAccessAction(member.userId)
        if (!result.ok) {
            toast.error(errorText(result))
            setOpened(current => (current?.member.userId === member.userId ? null : current))
            return
        }
        setOpened(current => (current?.member.userId === member.userId ? { member, access: result } : current))
    }, [errorText])

    const openMember = (member: WorkspaceMember) => {
        setOpened({ member, access: null })
        void loadAccess(member)
    }

    // Every change made from the drill-in reads the person's Boxes again: one level moved can
    // change where another comes from.
    const changeAccess = async (member: WorkspaceMember, action: () => Promise<Result>) => {
        if (busy) return
        setBusy(true)
        const result = await action()
        if (!result.ok) toast.error(errorText(result))
        await loadAccess(member)
        setBusy(false)
    }

    const changeScope = (member: WorkspaceMember, scope: BoxScope) =>
        changeAccess(member, async () => {
            const result = await setMemberBoxScopeAction(member.userId, scope)
            if (result.ok) setMembers(current => current.map(m => (m.userId === member.userId ? { ...m, boxScope: scope } : m)))
            return result
        })

    const changeLevel = (member: WorkspaceMember, box: MemberBoxAccess, level: BoxAccess) =>
        changeAccess(member, async () => {
            const result = level === 'none' ? await revokeSpaceAccessAction(box.spaceId, member.userId) : await grantSpaceAccessAction(box.spaceId, [member.userId], level)
            if (result.ok) syncBoardGrant(box.spaceId, member.userId, level === 'none' ? null : level)
            return result
        })

    // Named first, so the person never loses the Box between the two writes.
    const restrictBox = (member: WorkspaceMember, box: MemberBoxAccess) =>
        changeAccess(member, async () => {
            if (box.source !== 'assigned') {
                const granted = await grantSpaceAccessAction(box.spaceId, [member.userId], 'use')
                if (!granted.ok) return granted
                syncBoardGrant(box.spaceId, member.userId, 'use')
            }
            const restricted = await setSpaceVisibilityAction(box.spaceId, 'restricted')
            if (restricted.ok) syncBoardVisibility(box.spaceId, 'restricted')
            return restricted
        })

    const invite = async (email: string, boxScope: BoxScope) => {
        const result = await inviteToWorkspaceAction(email, boxScope)
        if (!result.ok) {
            toast.error(errorText(result))
            return false
        }
        if (result.inviteUrl) setInviteLink({ email, url: result.inviteUrl })
        else toast.success(t('invite.sent', { email }))
        refresh()
        return true
    }

    const run = async (action: () => Promise<Result>, success?: string) => {
        if (busy) return
        setBusy(true)
        const result = await action()
        setBusy(false)
        if (!result.ok) return toast.error(errorText(result))
        if (success) toast.success(success)
        refresh()
    }

    const label = (member: WorkspaceMember) => member.email ?? t('fallbackLabel')

    return (
        <Dialog
            open={open}
            onOpenChange={next => {
                if (!next) setOpened(null)
                onOpenChange(next)
            }}
        >
            <PanelDialogContent className="sm:h-[min(40rem,88dvh)] sm:max-w-lg">
                <WorkspaceMembersView
                    loading={loading}
                    members={members}
                    invites={invites}
                    currentUserId={currentUserId}
                    currentRole={currentRole}
                    maxSeats={workspace?.max_seats ?? null}
                    inviteLink={inviteLink}
                    busy={busy}
                    profileOf={profileOf}
                    onInvite={invite}
                    onRoleChange={(member, role) => run(() => setMemberRoleAction(member.userId, role), role === 'admin' ? t('nowAdmin', { name: label(member) }) : t('nowMember', { name: label(member) }))}
                    onRemove={member => run(() => removeMemberAction(member.userId), t('removed', { name: label(member) }))}
                    onRevoke={inv => run(() => revokeInvitationAction(inv.id))}
                    opened={opened}
                    onOpenMember={openMember}
                    onCloseMember={() => setOpened(null)}
                    onScopeChange={changeScope}
                    onBoxLevelChange={changeLevel}
                    onRestrictBox={restrictBox}
                />
            </PanelDialogContent>
        </Dialog>
    )
}
