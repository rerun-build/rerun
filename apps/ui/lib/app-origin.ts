import { organizationRootDomain } from '@/lib/brand/root-domain'
import { workspaceBrand } from '@/lib/brand/workspace'
import { requestHost } from '@/lib/request-host'
import { headers } from 'next/headers'
import { site } from '@/lib/site'

const CONFIGURED_ORIGIN = (process.env.NEXT_PUBLIC_APP_URL ?? site.url).replace(/\/$/, '')

// Where a Stripe redirect (checkout, portal, Connect onboarding) has to land the user back.
// In dev the port is whatever the workspace was handed - Conductor gives each one its own
// $CONDUCTOR_PORT - so a fixed NEXT_PUBLIC_APP_URL sends the user to another workspace's app, or to
// nothing at all. The host the request came in on is the only origin that is actually running.
export async function getAppOrigin(): Promise<string> {
    if (process.env.NODE_ENV !== 'development') return CONFIGURED_ORIGIN

    const host = requestHost(await headers())
    return host ? `http://${host}` : CONFIGURED_ORIGIN
}

// Where a link about a workspace, handed to someone else, opens it.
export async function appOriginOf(workspaceId: number): Promise<string> {
    if (!organizationRootDomain()) return getAppOrigin()
    return (await workspaceBrand(workspaceId)).appUrl ?? (await getAppOrigin())
}
