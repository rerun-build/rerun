'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useEffect, type ReactNode } from 'react'

import { CONSOLE_SECTIONS, consoleSectionOf } from '@/ee/lib/organizations/console-routes'
import { routes } from '@/lib/routes'
import { abortWorkspaceSwitch } from '@/lib/workspace/workspace-switch'

import { useConsole } from './ConsoleProvider'
import { OrganizationShell } from './OrganizationShell'
import type { OrganizationIdentity } from './types'

// `hosted`: organizations have addresses of their own here, so there are domains to manage.
export function ConsoleFrame({ organization, hosted, children }: { organization: OrganizationIdentity; hosted: boolean; children: ReactNode }) {
    const { suspended } = useConsole()
    const router = useRouter()

    // Back from a workspace just opened, the browser may give the page as it was left: under its loader.
    useEffect(() => {
        const comeBack = (event: PageTransitionEvent) => {
            if (!event.persisted) return
            abortWorkspaceSwitch()
            router.refresh()
        }
        window.addEventListener('pageshow', comeBack)
        return () => window.removeEventListener('pageshow', comeBack)
    }, [router])

    return (
        <OrganizationShell organization={organization} active={consoleSectionOf(usePathname())} hrefs={hosted ? CONSOLE_SECTIONS : { ...CONSOLE_SECTIONS, domains: undefined }} backHref={routes.home} suspended={suspended}>
            {children}
        </OrganizationShell>
    )
}
