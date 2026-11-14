import 'server-only'

import type { WorkspaceContext } from '@/app/api/_auth/ownership'
import { filePreviewKind } from '@/lib/files/preview'
import { downloadPrivateFile } from '@/lib/storage/private'
import { TEXT_FILE_PAGE_CHARS } from '@rerun/contracts'

import { FOREMAN_FILES_BUCKET, foremanFileKey } from './files'

export type ForemanFileRead = { content: string; truncated: boolean }

export async function readForemanFile(ctx: Pick<WorkspaceContext, 'userId' | 'workspace' | 'supabase'>, sessionId: string, path: string): Promise<ForemanFileRead> {
    const name = path.split('/').pop() ?? path
    if (filePreviewKind(name) !== 'text') {
        return { content: `${name} is not a text file, so its contents cannot be read here.`, truncated: false }
    }
    const blob = await downloadPrivateFile(ctx.supabase, FOREMAN_FILES_BUCKET, foremanFileKey(ctx, sessionId, path))
    const text = await blob.text()
    return { content: text.slice(0, TEXT_FILE_PAGE_CHARS), truncated: text.length > TEXT_FILE_PAGE_CHARS }
}
