import { remoteComputersListSchema, remoteComputerViewSchema, type RemoteComputerRule, type RemoteComputerUpsert, type RemoteComputerView } from '@rerun/contracts'

import { request } from './client'
import type { EngineConnection } from './types'

// The computers linked to the workspace, as its box knows them: online or not, what they said about
// themselves, and the rules the coworkers follow on each.

const computerPath = (id: string) => `/remote/computers/${encodeURIComponent(id)}`

// A short budget: the list is polled while the dialog is open, a box that does not answer reads as
// every computer offline rather than a spinner.
export async function listRemoteComputers(conn: EngineConnection): Promise<RemoteComputerView[]> {
    return request(conn, '/remote/computers', { method: 'GET', signal: AbortSignal.timeout(5_000) }, d => remoteComputersListSchema.parse(d).computers)
}

export async function upsertRemoteComputer(conn: EngineConnection, id: string, body: RemoteComputerUpsert): Promise<RemoteComputerView> {
    return request(conn, computerPath(id), { method: 'PUT', body: JSON.stringify(body) }, d => remoteComputerViewSchema.parse(d))
}

export async function addRemoteComputerRule(conn: EngineConnection, id: string, rule: RemoteComputerRule): Promise<RemoteComputerView> {
    return request(conn, `${computerPath(id)}/rules`, { method: 'POST', body: JSON.stringify(rule) }, d => remoteComputerViewSchema.parse(d))
}

export async function deleteRemoteComputer(conn: EngineConnection, id: string): Promise<void> {
    await request(conn, computerPath(id), { method: 'DELETE' }, () => undefined)
}
