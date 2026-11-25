// No 'server-only': the session reads it, and what reads the session is also bundled for the
// Trigger.dev tasks, where no request answers.
import { requestHost } from '@/lib/request-host'
import { headers } from 'next/headers'
import { cache } from 'react'
import { hostSite, type HostSite } from './site'

const isDynamicBailout = (err: unknown): boolean => (err as { digest?: unknown } | null)?.digest === 'DYNAMIC_SERVER_USAGE'

// Null outside a request. The bail-out that keeps a page which depends on its host from being built
// once for every host goes through.
async function currentHost(): Promise<string | null> {
    try {
        return requestHost(await headers())
    } catch (err) {
        if (isDynamicBailout(err)) throw err
        return null
    }
}

// Whose app the request came in on, read once per render.
export const requestSite = cache(async (): Promise<HostSite> => hostSite(await currentHost()))

// The organization whose address the request came in on, if any.
export async function hostOrganizationId(): Promise<string | null> {
    const site = await requestSite()
    return site.kind === 'organization' ? site.organizationId : null
}

// What signs in by another way than an invitation, or opens a workspace, exists on Rerun's address alone.
export async function isRerunHost(): Promise<boolean> {
    return (await requestSite()).kind === 'rerun'
}
