import type { RemoteCapability, RemoteComputerSettings, RemoteFacts, RemoteOs } from '@rerun/contracts'

export type ComputerStatus = 'online' | 'busy' | 'paused' | 'offline'

// One computer of the workspace as the screens show it: what the hub knows, and what its box says now.
export type ComputerItem = {
    id: string
    name: string
    handle: string
    os: RemoteOs
    arch: string
    hostname: string
    appVersion: string
    linkedBy: { id: string; name: string } | null
    linkedAt: string
    lastSeenAt: string | null
    status: ComputerStatus
    capabilities: RemoteCapability[]
    facts: RemoteFacts | null
    settings: RemoteComputerSettings | null
    runningJobs: number
    // An admin, or the person who linked it.
    canManage: boolean
}

export type ComputersEngineState = 'ok' | 'unreachable' | 'needs-update' | 'none'

export type ComputersList = { computers: ComputerItem[]; engine: ComputersEngineState }
