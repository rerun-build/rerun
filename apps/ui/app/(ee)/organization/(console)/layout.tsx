import type { ReactNode } from 'react'

import { WorkspaceSwitchLoader } from '@/components/layout/WorkspaceSwitchLoader'
import { ConsoleFrame } from '@/ee/components/organization/ConsoleFrame'
import { ConsoleProvider } from '@/ee/components/organization/ConsoleProvider'
import { openConsole } from '@/ee/lib/organizations/console.server'
import { organizationRootDomain } from '@/lib/brand/root-domain'

export default async function ConsoleLayout({ children }: { children: ReactNode }) {
    const { organization, role, userId } = await openConsole()
    return (
        <ConsoleProvider userId={userId} role={role} suspended={organization.status !== 'active'}>
            <ConsoleFrame organization={{ name: organization.name, iconUrl: organization.icon_url }} hosted={organizationRootDomain() !== null}>{children}</ConsoleFrame>
            <WorkspaceSwitchLoader />
        </ConsoleProvider>
    )
}
