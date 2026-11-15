import { connectTargetSchema, installResultSchema, resolvedServiceSchema, type ConnectTarget, type InstallResultView, type ResolvedService } from '@rerun/contracts'

import { api } from '@/api/client'

type Caller = { accessToken: string; workspaceId: number }

const base = (agentId: string) => `/api/v1/agents/${encodeURIComponent(agentId)}/services`
const one = (agentId: string, slug: string) => `${base(agentId)}/${encodeURIComponent(slug)}`

export async function resolveServices(caller: Caller, agentId: string, services: { slug: string; reason?: string }[]): Promise<ResolvedService[]> {
    return resolvedServiceSchema.array().parse(await api(`${base(agentId)}/resolve`, { ...caller, method: 'POST', body: { services } }))
}

export async function readService(caller: Caller, agentId: string, slug: string): Promise<ResolvedService> {
    return resolvedServiceSchema.parse(await api(one(agentId, slug), caller))
}

export async function installService(caller: Caller, agentId: string, slug: string, values: Record<string, string>, authMethodId?: string): Promise<InstallResultView> {
    return installResultSchema.parse(await api(`${one(agentId, slug)}/install`, { ...caller, method: 'POST', body: { values, authMethodId } }))
}

export async function connectService(caller: Caller, agentId: string, slug: string): Promise<ConnectTarget> {
    return connectTargetSchema.parse(await api(`${one(agentId, slug)}/connect`, { ...caller, method: 'POST' }))
}

export async function claimServiceSignIn(caller: Caller, agentId: string, slug: string, claim: string): Promise<void> {
    await api(`${one(agentId, slug)}/authorized`, { ...caller, method: 'POST', body: { claim } })
}
