import { mobileApi, type ChangeOpenChatsInput, type OpenChats } from '@rerun/contracts'

import { hub } from '@/api/client'

type Caller = { accessToken: string; workspaceId: number }

export async function fetchOpenChats(caller: Caller, agentId: string): Promise<OpenChats> {
    return hub(mobileApi.getOpenChats, { ...caller, params: { id: agentId } })
}

export async function changeOpenChats(caller: Caller, agentId: string, body: ChangeOpenChatsInput): Promise<OpenChats> {
    return hub(mobileApi.changeOpenChats, { ...caller, params: { id: agentId }, body })
}
