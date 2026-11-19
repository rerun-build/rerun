import type { HubMoldwrightCredit } from '@moldwright/contracts'

export function isAiStatusHubTool(name: string): name is 'rerun_credit' {
    return name === 'rerun_credit'
}

export async function readMoldwrightCredit(_workspaceId: number): Promise<{ credit: HubMoldwrightCredit | null }> {
    return { credit: null }
}
