import { resolveRunTarget } from '@/app/api/_services/chat.service'
import * as engine from '@/lib/engine/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileAction } from './file.actions'

vi.mock('@/app/api/_services/chat.service', () => ({ resolveRunTarget: vi.fn() }))
vi.mock('@/lib/engine/client', () => ({ readFileText: vi.fn() }))

describe('readFileAction', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(resolveRunTarget).mockResolvedValue({
            engineAgentId: 'engine-agent',
            conn: { baseUrl: 'https://engine.test', apiKey: null },
        })
    })

    it('returns the file content', async () => {
        vi.mocked(engine.readFileText).mockResolvedValue({ path: 'notes.txt', content: 'real workspace file' })

        const result = await readFileAction('agent', 'notes.txt')

        expect(result).toEqual({ content: 'real workspace file', truncated: false })
        expect(engine.readFileText).toHaveBeenCalledWith(
            { baseUrl: 'https://engine.test', apiKey: null },
            '/agents/engine-agent/files',
            'notes.txt',
        )
    })

    it('keeps the existing truncation signal for large text files', async () => {
        vi.mocked(engine.readFileText).mockResolvedValue({ path: 'large.txt', content: 'x'.repeat(100_000) })

        await expect(readFileAction('agent', 'large.txt')).resolves.toMatchObject({ truncated: true })
    })
})
