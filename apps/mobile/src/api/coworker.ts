import { coworkerFilesSchema, installedServiceSchema, routinesViewSchema, skillSummariesViewSchema, type CoworkerFiles, type InstalledServiceView, type RoutineKind, type RoutineView, type SkillSummary } from '@moldwright/contracts'

import { api } from '@/api/client'

type Caller = { accessToken: string; workspaceId: number }

const agentPath = (agentId: string) => `/api/v1/agents/${encodeURIComponent(agentId)}`

export async function renameCoworker(caller: Caller, agentId: string, name: string): Promise<void> {
    await api(agentPath(agentId), { ...caller, method: 'PATCH', body: { name } })
}

export async function deleteCoworker(caller: Caller, agentId: string): Promise<void> {
    await api(agentPath(agentId), { ...caller, method: 'DELETE' })
}

export async function fetchCoworkerFiles(caller: Caller, agentId: string): Promise<CoworkerFiles> {
    return coworkerFilesSchema.parse(await api(`${agentPath(agentId)}/files`, caller))
}

export async function fetchInstalledServices(caller: Caller, agentId: string): Promise<InstalledServiceView[]> {
    return installedServiceSchema.array().parse(await api(`${agentPath(agentId)}/services`, caller))
}

export async function fetchRoutines(caller: Caller, agentId: string): Promise<RoutineView[]> {
    return routinesViewSchema.parse(await api(`${agentPath(agentId)}/routines`, caller)).routines
}

export async function fetchCoworkerSkills(caller: Caller, agentId: string): Promise<SkillSummary[]> {
    return skillSummariesViewSchema.parse(await api(`${agentPath(agentId)}/skills`, caller)).skills
}

export async function setRoutineEnabled(caller: Caller, agentId: string, kind: RoutineKind, slug: string, enabled: boolean): Promise<void> {
    await api(`${agentPath(agentId)}/routines/${kind}/${encodeURIComponent(slug)}`, { ...caller, method: 'PATCH', body: { enabled } })
}
