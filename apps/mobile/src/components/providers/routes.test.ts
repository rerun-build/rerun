import { logoOf } from '@/api/models'

import { signsIn } from './routes'

jest.mock('expo-router', () => ({ router: {} }))
jest.mock('@/api/client', () => ({ api: jest.fn() }))

describe('how a connection is put back on its feet', () => {
    it('signs in again only on Claude and ChatGPT, and pastes a new key everywhere else', () => {
        expect(signsIn('claude')).toBe(true)
        expect(signsIn('codex')).toBe(true)
        for (const provider of ['opencode', 'anthropic', 'openai', 'google', 'openrouter']) expect(signsIn(provider)).toBe(false)
    })

    it('shows OpenCode under its own mark', () => {
        expect(logoOf('opencode')).toBe('opencode')
        expect(logoOf('openrouter')).toBe('rerun')
    })
})
