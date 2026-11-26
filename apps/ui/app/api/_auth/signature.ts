import type { Brand } from '@rerun/contracts'

import type { WorkspaceContext } from '@/app/api/_auth/ownership'
import { workspaceBrand } from '@/lib/brand/workspace'

export type Signer = Pick<WorkspaceContext, 'organizationStaff'> & { workspace: { id: number } }

// The brand that signs what this person does in the workspace, null for a member, who signs with
// their own name. Anything written where the workspace's people or coworkers read it (a message, a
// page of the Brain, a key, an invitation, a prompt) asks for it first.
export async function brandSignature(signer: Signer): Promise<Brand | null> {
    return signer.organizationStaff ? workspaceBrand(signer.workspace.id) : null
}

// The engine has no users of its own: every write to the Brain names a person in the page history.
export async function brainAuthorOf(signer: Signer & { userId: string; email: string | null }): Promise<string> {
    const brand = await brandSignature(signer)
    return `user:${brand?.name ?? signer.email ?? signer.userId}`
}
