import { Suspense, type ReactNode } from 'react'

import { BrandStyle } from '@/components/brand/BrandStyle'
import { WorkspaceSwitchLoader } from '@/components/layout/WorkspaceSwitchLoader'
import { ConsoleLoading, ConsoleReturn } from '@/ee/components/organization/ConsoleFrame'
import { ConsoleProvider } from '@/ee/components/organization/ConsoleProvider'
import { openConsole, openConsoleOverview, openConsoleViewer } from '@/ee/lib/organizations/console.server'
import { brandOfOrganization } from '@/ee/services/organization-brand.service'
import { organizationRootDomain } from '@/lib/brand/root-domain'

export default async function ConsoleLayout({ children }: { children: ReactNode }) {
    const { supabase, organization, role, userId } = await openConsole()
    const [brand, viewer] = await Promise.all([brandOfOrganization(supabase, organization), openConsoleViewer()])
    return (
        <>
            <BrandStyle brand={brand} />
            <Suspense fallback={<ConsoleLoading organization={{ name: organization.name, iconUrl: organization.icon_url }} hosted={organizationRootDomain() !== null} />}>
                <ConsoleProvider userId={userId} role={role} suspended={organization.status !== 'active'} viewer={viewer} brand={brand} overview={openConsoleOverview()}>
                    {children}
                </ConsoleProvider>
            </Suspense>
            <ConsoleReturn />
            <WorkspaceSwitchLoader />
        </>
    )
}
