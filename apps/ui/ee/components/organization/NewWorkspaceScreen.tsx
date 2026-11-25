'use client'

import { isStableLocale } from '@rerun/i18n'
import { useLocale } from 'next-intl'

import { createOrganizationWorkspaceAction } from '@/ee/actions/organization.actions'

import { useConsole, useWriteBlock } from './ConsoleProvider'
import { NewWorkspaceView, type NewWorkspace } from './NewWorkspaceView'
import { useConsoleChange } from './useConsoleChange'

export function NewWorkspaceScreen({ email }: { email: string }) {
    const locale = useLocale()
    const { brand, workspaces, maxWorkspaces, reserveMicros, reload } = useConsole()
    const block = useWriteBlock()
    const { submit } = useConsoleChange(reload)

    const create = ({ name, adminEmail, logo, starting }: NewWorkspace) => {
        const form = new FormData()
        form.append('name', name)
        form.append('adminEmail', adminEmail)
        if (isStableLocale(locale)) form.append('locale', locale)
        if (logo) form.append('logoFile', logo)
        return submit(() => createOrganizationWorkspaceAction(form, starting ?? undefined))
    }

    return <NewWorkspaceView brand={brand} email={email} reserveMicros={reserveMicros} limitReached={workspaces.length >= maxWorkspaces ? maxWorkspaces : null} block={block} onCreate={create} />
}
