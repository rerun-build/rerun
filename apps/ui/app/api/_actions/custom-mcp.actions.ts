'use server'

import { assertAgentAccess } from '@/app/api/_auth/access'
import { listAgentConnectors, removeCustomMcpServer } from '@/app/api/_services/custom-mcp.service'
import type { CustomMcpServer, InstalledService } from '@/lib/services/types'
import { refusalOf, type SuccessResult } from '@/lib/i18n/action-error'

export async function listAgentConnectorsAction(agentId: string): Promise<{ services: InstalledService[]; custom: CustomMcpServer[] }> {
    try {
        const { actor } = await assertAgentAccess(agentId, 'use')
        return await listAgentConnectors(agentId, actor)
    } catch {
        return { services: [], custom: [] }
    }
}

export async function removeCustomMcpServerAction(agentId: string, name: string): Promise<SuccessResult> {
    try {
        const { actor } = await assertAgentAccess(agentId, 'manage')
        await removeCustomMcpServer(agentId, name, actor)
        return { success: true }
    } catch (err) {
        return { success: false, ...refusalOf(err, 'removeServerFailed') }
    }
}
