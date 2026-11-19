import type { TableSourcesRequest, TableSourcesResult } from '@moldwright/contracts'
import { getSystemDb, systemDbExists } from '../systemDb.js'
import { readPaidSources, writePaidSources, type PaidSourceRecord } from '../../paid-data/store.js'

export async function recordPaidSources(agentId: string, record: PaidSourceRecord): Promise<void> {
    const { client } = await getSystemDb(agentId)
    await writePaidSources(client, record)
}

export async function lookupPaidSources(agentIds: string[], rows: TableSourcesRequest['rows']): Promise<TableSourcesResult> {
    const clients = await Promise.all(agentIds.filter(systemDbExists).map(async id => (await getSystemDb(id)).client))
    return readPaidSources(clients, rows)
}
