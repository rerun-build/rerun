import type { ConnectionConfig } from '@moldwright/contracts'

export { connectionConfigSchema, RERUN_CONNECTION_ID } from '@moldwright/contracts'
export type { ConnectionConfig, ConnectionSummary } from '@moldwright/contracts'

export type LoadedConnection = {
    id: string
    config: ConnectionConfig
    env: Record<string, string>
}
