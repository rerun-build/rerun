'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useEffect, type ComponentType, type ReactNode } from 'react'

import { CONSOLE_NEW_WORKSPACE, CONSOLE_SECTIONS, consoleSectionOf, consoleWorkspaceIdOf } from '@/ee/lib/organizations/console-routes'
import { routes } from '@/lib/routes'
import { abortWorkspaceSwitch } from '@/lib/workspace/workspace-switch'

import { BrandSkeleton } from './BrandView'
import { countAlerts } from './console-alerts'
import { useConsole } from './ConsoleProvider'
import { CreditSkeleton } from './CreditView'
import { DomainsSkeleton } from './DomainsView'
import { NewWorkspaceSkeleton } from './NewWorkspaceView'
import { OrganizationShell } from './OrganizationShell'
import { TeamSkeleton } from './TeamView'
import type { ConsoleSection, OrganizationIdentity } from './types'
import { WorkspaceDetailSkeleton } from './WorkspaceDetailView'
import { WorkspacesSkeleton } from './WorkspacesView'

const SKELETONS: Record<ConsoleSection, ComponentType> = { workspaces: WorkspacesSkeleton, credit: CreditSkeleton, team: TeamSkeleton, brand: BrandSkeleton, domains: DomainsSkeleton }

// `hosted`: organizations have addresses of their own here, so there are domains to manage.
const hrefsOf = (hosted: boolean) => (hosted ? CONSOLE_SECTIONS : { ...CONSOLE_SECTIONS, domains: undefined })

type ConsoleFrameProps = { organization: OrganizationIdentity; hosted: boolean; children: ReactNode }

export function ConsoleFrame({ organization, hosted, children }: ConsoleFrameProps) {
    const { suspended, viewer, workspaces, reserveMicros } = useConsole()
    const pathname = usePathname()
    const workspaceId = consoleWorkspaceIdOf(pathname)
    const current = workspaces.find(workspace => workspace.id === workspaceId)

    return (
        <OrganizationShell
            organization={organization}
            active={consoleSectionOf(pathname)}
            hrefs={hrefsOf(hosted)}
            backHref={routes.home}
            suspended={suspended}
            viewer={viewer}
            reserveMicros={reserveMicros}
            alerts={countAlerts(workspaces)}
            current={current && { workspace: current, workspaces }}
        >
            {children}
        </OrganizationShell>
    )
}

// Back from a workspace just opened, the browser may give the page as it was left: under its loader.
export function ConsoleReturn() {
    const router = useRouter()
    useEffect(() => {
        const comeBack = (event: PageTransitionEvent) => {
            if (!event.persisted) return
            abortWorkspaceSwitch()
            router.refresh()
        }
        window.addEventListener('pageshow', comeBack)
        return () => window.removeEventListener('pageshow', comeBack)
    }, [router])
    return null
}

// What stands there while the workspaces are read.
export function ConsoleLoading({ organization, hosted }: { organization: OrganizationIdentity; hosted: boolean }) {
    const pathname = usePathname()
    if (pathname === CONSOLE_NEW_WORKSPACE) return <NewWorkspaceSkeleton />
    const PageSkeleton = consoleWorkspaceIdOf(pathname) === null ? SKELETONS[consoleSectionOf(pathname)] : WorkspaceDetailSkeleton
    return (
        <OrganizationShell organization={organization} active={consoleSectionOf(pathname)} hrefs={hrefsOf(hosted)} backHref={routes.home} viewer={null} reserveMicros={null} alerts={0}>
            <PageSkeleton />
        </OrganizationShell>
    )
}
