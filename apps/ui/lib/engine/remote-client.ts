import { remoteComputersListSchema, remoteComputerViewSchema, remoteJobLogsSchema, remoteJobSchema, remoteJobsListSchema, type RemoteComputerRule, type RemoteComputerUpsert, type RemoteComputerView, type RemoteJob, type RemoteJobLogs } from '@rerun/contracts'
import { z } from 'zod'

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

// A computer's jobs are read from the computer itself, through its socket: an offline one answers 409.
export async function listRemoteJobs(conn: EngineConnection, id: string): Promise<RemoteJob[]> {
    return request(conn, `${computerPath(id)}/jobs`, { method: 'GET', signal: AbortSignal.timeout(8_000) }, d => remoteJobsListSchema.parse(d).jobs)
}

export async function getRemoteJobLogs(conn: EngineConnection, id: string, jobId: string): Promise<RemoteJobLogs> {
    return request(conn, `${computerPath(id)}/jobs/${encodeURIComponent(jobId)}`, { method: 'GET', signal: AbortSignal.timeout(8_000) }, d => remoteJobLogsSchema.parse(d))
}

export async function stopRemoteJob(conn: EngineConnection, id: string, jobId: string): Promise<RemoteJob> {
    return request(conn, `${computerPath(id)}/jobs/${encodeURIComponent(jobId)}/stop`, { method: 'POST' }, d => z.object({ job: remoteJobSchema }).parse(d).job)
}
