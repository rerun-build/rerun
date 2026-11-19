import type { HubRerunCredit } from '@moldwright/contracts'

export function isAiStatusHubTool(name: string): name is 'rerun_credit' {
    return name === 'rerun_credit'
}

export async function readRerunCredit(_workspaceId: number): Promise<{ credit: HubRerunCredit | null }> {
    return { credit: null }
}
