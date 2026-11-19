import { mobileApi, type ConnectTarget, type InstallResultView, type ResolvedService } from '@rerun/contracts'

import { hub } from '@/api/client'

type Caller = { accessToken: string; workspaceId: number }

export async function resolveServices(caller: Caller, agentId: string, services: { slug: string; reason?: string }[]): Promise<ResolvedService[]> {
    return hub(mobileApi.resolveServices, { ...caller, params: { id: agentId }, body: { services } })
}

export async function readService(caller: Caller, agentId: string, slug: string): Promise<ResolvedService> {
    return hub(mobileApi.getService, { ...caller, params: { id: agentId, slug } })
}

export async function installService(caller: Caller, agentId: string, slug: string, values: Record<string, string>, authMethodId?: string): Promise<InstallResultView> {
    return hub(mobileApi.installService, { ...caller, params: { id: agentId, slug }, body: { values, authMethodId } })
}

export async function connectService(caller: Caller, agentId: string, slug: string): Promise<ConnectTarget> {
    return hub(mobileApi.connectService, { ...caller, params: { id: agentId, slug } })
}

// The claim the sign-in ended with: the hub writes the token on the Box and flips the entry only now.
export async function claimServiceSignIn(caller: Caller, agentId: string, slug: string, claim: string): Promise<void> {
    await hub(mobileApi.claimServiceSignIn, { ...caller, params: { id: agentId, slug }, body: { claim } })
}
