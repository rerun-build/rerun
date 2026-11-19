import { mobileApi, type MemberProfile } from '@rerun/contracts'

import { hub } from '@/api/client'

type Caller = { accessToken: string; workspaceId: number }

export async function fetchMemberProfiles(caller: Caller): Promise<MemberProfile[]> {
    return hub(mobileApi.listMembers, caller)
}
