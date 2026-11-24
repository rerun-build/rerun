// No 'server-only', see lib/email/client.ts: the Trigger.dev tasks read it for the emails they send.
import { RERUN_BRAND, type Brand } from '@rerun/contracts'

// The brand a workspace is shown under, outside any request.
export async function workspaceBrand(_workspaceId: number): Promise<Brand> {
    return RERUN_BRAND
}

// A sign-in code is about an address before it is about a workspace: the pending invitation, or the
// host it was asked from, says whose brand it carries.
export async function authEmailBrand(_request: { email: string; redirectTo: string | null }): Promise<Brand> {
    return RERUN_BRAND
}
