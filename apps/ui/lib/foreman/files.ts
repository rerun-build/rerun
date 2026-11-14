import 'server-only'

import type { WorkspaceContext } from '@/app/api/_auth/ownership'

export const FOREMAN_FILES_BUCKET = 'foreman-files'

export function foremanFileKey(ctx: Pick<WorkspaceContext, 'userId' | 'workspace'>, sessionId: string, path: string): string {
    return `${ctx.workspace.id}/${ctx.userId}/${sessionId}/${path}`
}
