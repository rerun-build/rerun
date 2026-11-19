import { memberProfileSchema, type MemberProfile } from '@moldwright/contracts'

import { api } from '@/api/client'

type Caller = { accessToken: string; workspaceId: number }

export async function fetchMemberProfiles(caller: Caller): Promise<MemberProfile[]> {
    return memberProfileSchema.array().parse(await api('/api/v1/members', caller))
}
