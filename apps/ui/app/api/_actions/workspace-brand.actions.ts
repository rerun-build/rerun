'use server'

import { requireWorkspaceId } from '@/app/api/_auth/ownership'
import { workspaceBrand } from '@/lib/brand/workspace'
import type { Brand } from '@rerun/contracts'

export async function loadWorkspaceBrandAction(): Promise<Brand> {
    return workspaceBrand(await requireWorkspaceId())
}
