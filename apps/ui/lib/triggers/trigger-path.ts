import { FOREMAN_AGENT_ID } from '@rerun/contracts'

// A coworker's webhook names the coworker's row, which says which workspace it belongs to. The Chief
// of Staff has no row and the same id in every workspace, so its webhook names the workspace instead.
const FOREMAN_TARGET = new RegExp(`^${FOREMAN_AGENT_ID}\\.([1-9][0-9]*)$`)

export type TriggerTarget = { kind: 'agent'; agentId: string } | { kind: 'foreman'; workspaceId: number }

export function triggerPath(agentId: string, workspaceId: number, slug: string, token: string): string {
    const target = agentId === FOREMAN_AGENT_ID ? `${FOREMAN_AGENT_ID}.${workspaceId}` : agentId
    return `/api/t/${target}/${slug}/${token}`
}

export function parseTriggerTarget(segment: string): TriggerTarget {
    const foreman = FOREMAN_TARGET.exec(segment)
    return foreman ? { kind: 'foreman', workspaceId: Number(foreman[1]) } : { kind: 'agent', agentId: segment }
}
