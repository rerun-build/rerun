'use client'

import { createContext, useContext, type ReactNode } from 'react'

import type { OrganizationRole, WriteBlock } from './types'

type Console = { userId: string; role: OrganizationRole; suspended: boolean }

const ConsoleContext = createContext<Console | null>(null)

export function ConsoleProvider({ children, ...console }: Console & { children: ReactNode }) {
    return <ConsoleContext.Provider value={console}>{children}</ConsoleContext.Provider>
}

export function useConsole(): Console {
    const console = useContext(ConsoleContext)
    if (!console) throw new Error('useConsole must be used within a ConsoleProvider')
    return console
}

export function useWriteBlock(min: OrganizationRole = 'admin'): WriteBlock | null {
    const { role, suspended } = useConsole()
    if (suspended) return 'suspended'
    return min === 'owner' && role !== 'owner' ? 'ownerOnly' : null
}
