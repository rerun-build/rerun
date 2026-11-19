import { mobileApi, type CoworkerFiles, type InstalledServiceView, type RoutineKind, type RoutineView, type SkillSummary } from '@rerun/contracts'

import { hub } from '@/api/client'

type Caller = { accessToken: string; workspaceId: number }

export async function renameCoworker(caller: Caller, agentId: string, name: string): Promise<void> {
    await hub(mobileApi.renameAgent, { ...caller, params: { id: agentId }, body: { name } })
}

export async function deleteCoworker(caller: Caller, agentId: string): Promise<void> {
    await hub(mobileApi.deleteAgent, { ...caller, params: { id: agentId } })
}

export async function fetchCoworkerFiles(caller: Caller, agentId: string): Promise<CoworkerFiles> {
    return hub(mobileApi.listAgentFiles, { ...caller, params: { id: agentId } })
}

export async function fetchInstalledServices(caller: Caller, agentId: string): Promise<InstalledServiceView[]> {
    return hub(mobileApi.listAgentServices, { ...caller, params: { id: agentId } })
}

export async function fetchRoutines(caller: Caller, agentId: string): Promise<RoutineView[]> {
    return (await hub(mobileApi.listAgentRoutines, { ...caller, params: { id: agentId } })).routines
}

export async function fetchCoworkerSkills(caller: Caller, agentId: string): Promise<SkillSummary[]> {
    return (await hub(mobileApi.listAgentSkills, { ...caller, params: { id: agentId } })).skills
}

export async function setRoutineEnabled(caller: Caller, agentId: string, kind: RoutineKind, slug: string, enabled: boolean): Promise<void> {
    await hub(mobileApi.setAgentRoutineEnabled, { ...caller, params: { id: agentId, kind, slug }, body: { enabled } })
}
