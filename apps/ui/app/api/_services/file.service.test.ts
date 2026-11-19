import * as engine from '@/lib/engine/client'
import { hashText } from '@/lib/files/editable'
import type { EngineConnection } from '@/lib/engine/types'
import { MAX_TEXT_WRITE_CHARS } from '@moldwright/contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { saveTextFile } from './file.service'

vi.mock('@/lib/engine/client', () => ({ readFileText: vi.fn(), writeFileText: vi.fn() }))

const conn: EngineConnection = { baseUrl: 'https://engine.test', apiKey: null }
const base = '/agents/engine-agent/files'

function pageOf(content: string) {
    return { path: 'notes.md', content, offset: 0, nextOffset: null, totalChars: content.length, truncated: false }
}

describe('saveTextFile', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(engine.writeFileText).mockResolvedValue(undefined)
    })

    it('writes when the file on disk still matches what the editor opened', async () => {
        vi.mocked(engine.readFileText).mockResolvedValue(pageOf('before'))

        const result = await saveTextFile(conn, base, 'notes.md', 'after', hashText('before'))

        expect(result).toEqual({ success: true })
        expect(engine.writeFileText).toHaveBeenCalledWith(conn, base, 'notes.md', 'after')
    })

    it('reports a conflict when the file changed underneath', async () => {
        vi.mocked(engine.readFileText).mockResolvedValue(pageOf('an agent rewrote this'))

        const result = await saveTextFile(conn, base, 'notes.md', 'after', hashText('before'))

        expect(result).toMatchObject({ success: false, conflict: true })
        expect(engine.writeFileText).not.toHaveBeenCalled()
    })

    it('skips the re-read when the caller opts out of conflict detection', async () => {
        const result = await saveTextFile(conn, base, 'notes.md', 'after', null)

        expect(result).toEqual({ success: true })
        expect(engine.readFileText).not.toHaveBeenCalled()
    })

    it('refuses content past the write cap', async () => {
        const result = await saveTextFile(conn, base, 'notes.md', 'x'.repeat(MAX_TEXT_WRITE_CHARS + 1), null)

        expect(result).toMatchObject({ success: false })
        expect(engine.writeFileText).not.toHaveBeenCalled()
    })

    it('refuses binary content whatever the client claims', async () => {
        const result = await saveTextFile(conn, base, 'module.pyc', 'payload\u0000\u0000', null)

        expect(result).toMatchObject({ success: false })
        expect(engine.writeFileText).not.toHaveBeenCalled()
    })

    it('surfaces the engine error rather than throwing', async () => {
        vi.mocked(engine.writeFileText).mockRejectedValue(new Error('The Box has no disk space left.'))

        const result = await saveTextFile(conn, base, 'notes.md', 'after', null)

        expect(result).toEqual({ success: false, error: 'The Box has no disk space left.' })
    })
})
