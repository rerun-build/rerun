'use client'

import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { toast } from 'sonner'

import { allocateOrganizationCreditAction, resendOrganizationWorkspaceInvitationAction } from '@/ee/actions/organization.actions'
import type { ConsoleSetup } from '@/ee/lib/organizations/console.server'

import { useConsole, useWriteBlock } from './ConsoleProvider'
import { CreditTransferDialog } from './CreditTransferDialog'
import { FirstVisit } from './FirstVisit'
import type { ConsoleWorkspace } from './types'
import { useConsoleChange } from './useConsoleChange'
import { WorkspacesView } from './WorkspacesView'

export function WorkspacesScreen({ setup }: { setup: ConsoleSetup | null }) {
    const t = useTranslations('organization')
    const { workspaces, maxWorkspaces, reserveMicros, brand, reload } = useConsole()
    const block = useWriteBlock()
    const { pending, run, submit } = useConsoleChange<string>(reload)
    const [giving, setGiving] = useState<ConsoleWorkspace | null>(null)
    const [dialogOpen, setDialogOpen] = useState(false)

    if (workspaces.length === 0 && setup) return <FirstVisit brand={brand} setup={setup} />

    const resend = ({ id, pendingAdmin }: ConsoleWorkspace) => {
        if (!pendingAdmin) return
        void run(String(id), () => resendOrganizationWorkspaceInvitationAction(id, pendingAdmin.invitationId), { done: () => toast.success(t('people.resent', { email: pendingAdmin.email })) })
    }

    return (
        <>
            <WorkspacesView
                workspaces={workspaces}
                maxWorkspaces={maxWorkspaces}
                reserveMicros={reserveMicros}
                block={block}
                resendingId={pending ? Number(pending) : null}
                onAddCredit={workspace => {
                    setGiving(workspace)
                    setDialogOpen(true)
                }}
                onResend={resend}
            />
            {giving && <CreditTransferDialog direction={dialogOpen ? 'allocate' : null} onOpenChange={setDialogOpen} reserveMicros={reserveMicros} workspaces={workspaces} fixedWorkspaceId={giving.id} onSubmit={transfer => submit(() => allocateOrganizationCreditAction(transfer))} />}
        </>
    )
}
