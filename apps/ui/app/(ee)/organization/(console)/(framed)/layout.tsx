import type { ReactNode } from 'react'

import { ConsoleFrame } from '@/ee/components/organization/ConsoleFrame'
import { openConsole } from '@/ee/lib/organizations/console.server'
import { organizationRootDomain } from '@/lib/brand/root-domain'

export default async function ConsoleFramedLayout({ children }: { children: ReactNode }) {
    const { organization } = await openConsole()
    return (
        <ConsoleFrame organization={{ name: organization.name, iconUrl: organization.icon_url }} hosted={organizationRootDomain() !== null}>
            {children}
        </ConsoleFrame>
    )
}
