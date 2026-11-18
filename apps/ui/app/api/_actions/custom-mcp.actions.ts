'use server'

import { listAgentConnectors, removeCustomMcpServer } from '@/app/api/_services/custom-mcp.service'
import type { CustomMcpServer, InstalledService } from '@/lib/services/types'
import { refusalOf, type SuccessResult } from '@/lib/i18n/action-error'

export async function listAgentConnectorsAction(agentId: string): Promise<{ services: InstalledService[]; custom: CustomMcpServer[] }> {
    try {
        return await listAgentConnectors(agentId)
    } catch {
        return { services: [], custom: [] }
    }
}

export async function removeCustomMcpServerAction(agentId: string, name: string): Promise<SuccessResult> {
    try {
        await removeCustomMcpServer(agentId, name)
        return { success: true }
    } catch (err) {
        return { success: false, ...refusalOf(err, 'removeServerFailed') }
    }
}
