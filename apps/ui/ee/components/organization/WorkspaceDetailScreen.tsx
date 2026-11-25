'use client'

import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { Suspense, use } from 'react'
import { toast } from 'sonner'

import { PANEL_CARD } from '@/components/ui/panel-row'
import {
    allocateOrganizationCreditAction,
    archiveOrganizationWorkspaceAction,
    deleteOrganizationWorkspaceAction,
    inviteOrganizationWorkspaceMemberAction,
    listOrganizationWorkspaceMembersAction,
    loadOrganizationCreditAction,
    loadOrganizationWorkspaceAction,
    openOrganizationWorkspaceAction,
    removeOrganizationWorkspaceMemberAction,
    restartOrganizationWorkspaceAction,
    restoreOrganizationWorkspaceAction,
    revokeOrganizationWorkspaceInvitationAction,
    setOrganizationWorkspaceMemberRoleAction,
    takeBackOrganizationCreditAction,
} from '@/ee/actions/organization.actions'
import { creditBalance, type CreditUsage } from '@/ee/lib/billing/credit-usage'
import { CONSOLE_HOME } from '@/ee/lib/organizations/console-routes'
import type { OrganizationWorkspaceDetail } from '@/ee/services/organization-workspaces.service'
import { cn } from '@/lib/utils'
import { clearTabWorkspace, readTabWorkspace } from '@/lib/workspace/tab-workspace'
import { enterActiveWorkspace } from '@/lib/workspace/workspace-switch'

import { consoleMachineOf, consoleMembersOf, consoleWorkspaceOf, type WorkspacePeople } from './console-data'
import { useConsole, useWriteBlock } from './ConsoleProvider'
import { consoleStatusOf, isBusy, type CreditTransfer } from './types'
import { useConsoleChange } from './useConsoleChange'
import { useConsoleData } from './useConsoleData'
import { useTakeBackNotice } from './useTakeBackNotice'
import { WorkspaceDetailView } from './WorkspaceDetailView'
import type { LifecycleAction } from './WorkspaceLifecycle'
import { WorkspaceUsage } from './WorkspaceUsage'

type Loaded = { workspace: OrganizationWorkspaceDetail }
type Reserve = { balanceMicros: number }

type WorkspaceDetailScreenProps = { initial: Loaded; initialPeople: WorkspacePeople; initialReserve: Reserve; usage: Promise<CreditUsage | null> }

const isWaiting = ({ workspace }: Loaded) => isBusy(consoleStatusOf(workspace))

export function WorkspaceDetailScreen({ initial, initialPeople, initialReserve, usage }: WorkspaceDetailScreenProps) {
    const workspaceId = initial.workspace.id
    const t = useTranslations('organization')
    const router = useRouter()
    const { userId } = useConsole()
    const block = useWriteBlock()
    const { data, reload } = useConsoleData(initial, () => loadOrganizationWorkspaceAction(workspaceId), { waiting: isWaiting })
    const people = useConsoleData(initialPeople, () => listOrganizationWorkspaceMembersAction(workspaceId))
    const reserve = useConsoleData(initialReserve, loadOrganizationCreditAction)
    const { pending, run } = useConsoleChange<LifecycleAction | 'restart' | 'open'>(reload)
    const credit = useConsoleChange(() => Promise.all([reload(), reserve.reload()]))
    const access = useConsoleChange(people.reload)
    const noticeTakeBack = useTakeBackNotice()

    const { workspace } = data
    const shown = consoleWorkspaceOf(workspace, t('workspaces.unnamed'))

    // A tab still on it would open the app on a workspace that is gone.
    const leaveDeleted = () => {
        toast.success(t('danger.deleted', { name: shown.name }))
        if (readTabWorkspace() !== workspaceId) return router.push(CONSOLE_HOME)
        clearTabWorkspace()
        window.location.assign(CONSOLE_HOME)
    }

    const takeBack = async (transfer: CreditTransfer) => {
        const result = await credit.submit(() => takeBackOrganizationCreditAction(transfer))
        if (result.ok) noticeTakeBack(transfer, result.micros)
        return result
    }

    const expectMembers = (change: (members: WorkspacePeople['members']) => WorkspacePeople['members']) => people.expect(current => ({ ...current, members: change(current.members) }))

    const openWorkspace = () => {
        let elsewhere: string | undefined
        const open = async () => {
            const result = await openOrganizationWorkspaceAction(workspaceId)
            if (result.ok) elsewhere = result.url
            return result
        }
        return run('open', open, { leave: () => (elsewhere ? window.location.assign(elsewhere) : enterActiveWorkspace()) })
    }

    return (
        <WorkspaceDetailView
            workspace={shown}
            {...consoleMembersOf(people.data, userId)}
            reserveMicros={reserve.data.balanceMicros}
            machine={consoleMachineOf(workspace)}
            usage={
                <Suspense fallback={<WorkspaceUsage balance={null} usage={null} />}>
                    <SpentCredit usage={usage} usedMicros={workspace.usedMicros} leftMicros={workspace.leftMicros} />
                </Suspense>
            }
            pending={pending}
            block={block}
            onBack={() => router.push(CONSOLE_HOME)}
            onOpenWorkspace={openWorkspace}
            onInvite={(email, role) => access.submit(() => inviteOrganizationWorkspaceMemberAction(workspaceId, email, role))}
            onRoleChange={(person, role) => {
                const undo = expectMembers(members => members.map(member => (member.userId === person.userId ? { ...member, role } : member)))
                void access.change(() => setOrganizationWorkspaceMemberRoleAction(workspaceId, person.userId, role), undo)
            }}
            onRemove={person => {
                const undo = expectMembers(members => members.filter(member => member.userId !== person.userId))
                void access.change(() => removeOrganizationWorkspaceMemberAction(workspaceId, person.userId), undo)
            }}
            onRevoke={invitation => {
                const undo = people.expect(current => ({ ...current, invites: current.invites.filter(invite => invite.id !== invitation.id) }))
                void access.change(() => revokeOrganizationWorkspaceInvitationAction(workspaceId, invitation.id), undo)
            }}
            onAllocate={transfer => credit.submit(() => allocateOrganizationCreditAction(transfer))}
            onTakeBack={takeBack}
            onRestart={() => run('restart', () => restartOrganizationWorkspaceAction(workspaceId), { done: () => toast.success(t('machine.restarting')) })}
            onArchive={() => run('archive', () => archiveOrganizationWorkspaceAction(workspaceId))}
            onRestore={() => run('restore', () => restoreOrganizationWorkspaceAction(workspaceId))}
            onDelete={() => run('delete', () => deleteOrganizationWorkspaceAction(workspaceId), { leave: leaveDeleted })}
        />
    )
}

function SpentCredit({ usage, usedMicros, leftMicros }: { usage: Promise<CreditUsage | null>; usedMicros: number; leftMicros: number }) {
    const tErrors = useTranslations('errors')
    const spent = use(usage)
    if (!spent) return <p className={cn('p-4 py-10 text-center text-sm text-muted-foreground', PANEL_CARD)}>{tErrors('loadCreditUsageFailed')}</p>
    return <WorkspaceUsage balance={creditBalance({ budgetMicros: 0, usedMicros, topupMicros: leftMicros }, spent)} usage={spent} />
}
