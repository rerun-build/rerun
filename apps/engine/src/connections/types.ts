import type { ConnectionConfig } from '@rerun/contracts'

export { connectionConfigSchema, RERUN_CONNECTION_ID } from '@rerun/contracts'
export type { ConnectionConfig, ConnectionSummary } from '@rerun/contracts'

export type LoadedConnection = {
    id: string
    config: ConnectionConfig
    env: Record<string, string>
}
