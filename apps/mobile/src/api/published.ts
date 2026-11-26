import { mobileApi, type PublishedLink } from '@rerun/contracts'

import { hub } from '@/api/client'

type Caller = { accessToken: string; workspaceId: number }

// The link as it stands now: null once it was unpublished.
export async function fetchPublishedLink(caller: Caller, slug: string): Promise<PublishedLink | null> {
    return (await hub(mobileApi.getPublishedLink, { ...caller, params: { slug } })).file
}

export async function makePublishedLinkPublic(caller: Caller, slug: string): Promise<PublishedLink> {
    return (await hub(mobileApi.makePublishedLinkPublic, { ...caller, params: { slug }, body: { access: 'public' } })).file
}

export async function dismissPublishedAccessRequest(caller: Caller, slug: string): Promise<void> {
    await hub(mobileApi.dismissPublishedAccessRequest, { ...caller, params: { slug } })
}
