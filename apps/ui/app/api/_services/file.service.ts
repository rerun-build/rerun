import * as engine from '@/lib/engine/client'
import type { EngineConnection } from '@/lib/engine/types'
import { hashText, looksBinary } from '@/lib/files/editable'
import { MAX_TEXT_WRITE_CHARS } from '@rerun/contracts'
import { refusal, type ActionRefusal } from '@/lib/i18n/action-error'

export type SaveFileResult = { success: true } | ({ success: false; conflict?: true } & ActionRefusal)

export async function saveTextFile(conn: EngineConnection, base: string, filePath: string, content: string, baseHash: string | null): Promise<SaveFileResult> {
    if (content.length > MAX_TEXT_WRITE_CHARS) {
        return { success: false, ...refusal('fileTooLongToSave', { max: MAX_TEXT_WRITE_CHARS }) }
    }
    if (looksBinary(content)) {
        return { success: false, ...refusal('fileNotTextSave') }
    }

    if (baseHash !== null) {
        const current = await engine.readFileText(conn, base, filePath).catch(() => null)
        if (current && hashText(current.content) !== baseHash) {
            return { success: false, ...refusal('fileChangedOnBox'), conflict: true }
        }
    }

    try {
        await engine.writeFileText(conn, base, filePath, content)
        return { success: true }
    } catch (err) {
        return { success: false, ...(err instanceof Error ? { error: err.message } : refusal('saveThisFileFailed')) }
    }
}
