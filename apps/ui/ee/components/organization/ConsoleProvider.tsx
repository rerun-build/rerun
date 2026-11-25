'use client'

import { createContext, use, useContext, useMemo, type ReactNode } from 'react'
import type { Brand } from '@rerun/contracts'
import { useTranslations } from 'next-intl'

import { loadOrganizationOverviewAction } from '@/ee/actions/organization.actions'
import type { OrganizationOverview } from '@/ee/services/organization-overview.service'

import { consoleWorkspaceOf } from './console-data'
import { consoleStatusOf, isBusy, type ConsoleWorkspace, type OrganizationRole, type WriteBlock } from './types'
import { useConsoleData } from './useConsoleData'

export type ConsoleViewer = { name: string | null; email: string | null; photo: string | null }

type Console = { userId: string; role: OrganizationRole; suspended: boolean; viewer: ConsoleViewer; brand: Brand }

type SharedConsole = Console & { workspaces: ConsoleWorkspace[]; maxWorkspaces: number; reserveMicros: number; reload: () => Promise<void> }

const ConsoleContext = createContext<SharedConsole | null>(null)

const anyBusy = ({ workspaces }: OrganizationOverview) => workspaces.some(workspace => isBusy(consoleStatusOf(workspace)))

// The workspaces and the reserve are read once for the whole console: the bar, the list and the credit
// never tell two stories.
export function ConsoleProvider({ overview, children, ...console }: Console & { overview: Promise<OrganizationOverview>; children: ReactNode }) {
    const t = useTranslations('organization.workspaces')
    const { data, reload } = useConsoleData(use(overview), loadOrganizationOverviewAction, { waiting: anyBusy })
    const workspaces = useMemo(() => data.workspaces.map(workspace => consoleWorkspaceOf(workspace, t('unnamed'))), [data.workspaces, t])
    return <ConsoleContext.Provider value={{ ...console, workspaces, maxWorkspaces: data.maxWorkspaces, reserveMicros: data.reserveMicros, reload }}>{children}</ConsoleContext.Provider>
}

export function useConsole(): SharedConsole {
    const console = useContext(ConsoleContext)
    if (!console) throw new Error('useConsole must be used within a ConsoleProvider')
    return console
}

export function useWriteBlock(min: OrganizationRole = 'admin'): WriteBlock | null {
    const { role, suspended } = useConsole()
    if (suspended) return 'suspended'
    return min === 'owner' && role !== 'owner' ? 'ownerOnly' : null
}
