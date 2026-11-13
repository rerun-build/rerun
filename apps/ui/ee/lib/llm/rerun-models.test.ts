import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RERUN_MODELS } from '@rerun/contracts'
import { RERUN_UPSTREAM_MODELS } from '@/lib/engine/constants'
import { getWorkspaceBudgetByEngineKey } from '@/ee/services/rerunBudget.service'
import { GET } from './rerun-models'

vi.mock('@/ee/services/rerunBudget.service', () => ({ getWorkspaceBudgetByEngineKey: vi.fn() }))

type Budget = Awaited<ReturnType<typeof getWorkspaceBudgetByEngineKey>>

const request = (authorization = 'Bearer engine-key') => new Request('https://hub.test/api/llm/models', { headers: { authorization } })

describe('GET /api/llm/models', () => {
    beforeEach(() => {
        vi.mocked(getWorkspaceBudgetByEngineKey).mockResolvedValue({ workspaceId: 1 } as Budget)
    })

    it('names the model behind each alias', async () => {
        const res = await GET(request())
        expect(await res.json()).toEqual({
            models: {
                [RERUN_MODELS.fast]: RERUN_UPSTREAM_MODELS.fast,
                [RERUN_MODELS.balanced]: RERUN_UPSTREAM_MODELS.balanced,
                [RERUN_MODELS.smart]: RERUN_UPSTREAM_MODELS.smart,
            },
        })
    })

    it('refuses a caller that is not a box', async () => {
        vi.mocked(getWorkspaceBudgetByEngineKey).mockResolvedValue(null)
        expect((await GET(request())).status).toBe(401)
        expect((await GET(request(''))).status).toBe(401)
    })
})
