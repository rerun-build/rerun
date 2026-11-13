import { describe, expect, it } from 'vitest'
import { planProviders } from './ai-sources'

describe('planProviders', () => {
    it('offers the Claude and ChatGPT plans, and OpenCode where it can run', () => {
        expect(planProviders(false)).toEqual(['claude', 'codex'])
        expect(planProviders(true)).toEqual(['claude', 'codex', 'opencode'])
    })

    it('leaves the Claude plan out when the workspace is not offered it', () => {
        expect(planProviders(false, { claude: false })).toEqual(['codex'])
        expect(planProviders(true, { claude: false })).toEqual(['codex', 'opencode'])
    })
})
