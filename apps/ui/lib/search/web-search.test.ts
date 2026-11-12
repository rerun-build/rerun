import { beforeEach, describe, expect, it, vi } from 'vitest'

import { searchBrave } from '@/lib/search/brave'
import { searchKeirolabs } from '@/lib/search/keirolabs'

import { searchTheWeb } from './web-search'

vi.mock('@/lib/search/brave', () => ({ searchBrave: vi.fn() }))
vi.mock('@/lib/search/keirolabs', () => ({ searchKeirolabs: vi.fn() }))

const BRAVE = { status: 200, ok: true, results: [{ title: 'Brave', url: 'https://brave.test', snippet: '' }] }
const KEIROLABS = { status: 200, ok: true, results: [{ title: 'Keirolabs', url: 'https://keirolabs.test', snippet: '' }] }

describe('searchTheWeb', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(searchBrave).mockResolvedValue(null)
        vi.mocked(searchKeirolabs).mockResolvedValue(null)
    })

    it('returns null when no provider has a key', async () => {
        await expect(searchTheWeb('rerun', 20)).resolves.toBeNull()
    })

    it('searches with Keirolabs when it is the only provider with a key', async () => {
        vi.mocked(searchKeirolabs).mockResolvedValue(KEIROLABS)

        await expect(searchTheWeb('rerun', 20)).resolves.toEqual(KEIROLABS)
        expect(searchKeirolabs).toHaveBeenCalledWith('rerun', 20)
    })

    it('keeps Brave when both have a key, and does not pay Keirolabs too', async () => {
        vi.mocked(searchBrave).mockResolvedValue(BRAVE)
        vi.mocked(searchKeirolabs).mockResolvedValue(KEIROLABS)

        await expect(searchTheWeb('rerun', 20)).resolves.toEqual(BRAVE)
        expect(searchKeirolabs).not.toHaveBeenCalled()
    })

    it('reports a Brave failure rather than retrying it on Keirolabs', async () => {
        vi.mocked(searchBrave).mockResolvedValue({ status: 429, ok: false, results: [] })
        vi.mocked(searchKeirolabs).mockResolvedValue(KEIROLABS)

        await expect(searchTheWeb('rerun', 20)).resolves.toEqual({ status: 429, ok: false, results: [] })
        expect(searchKeirolabs).not.toHaveBeenCalled()
    })
})
