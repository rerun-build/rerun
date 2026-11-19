import { describe, expect, it } from 'vitest'

import { runUsesScreen, screenSite, serializeTakeoverResult } from '@moldwright/contracts'

const user = (text: string) => ({ role: 'user', parts: [{ type: 'text', text }] })
const assistant = (...parts: { type: string; toolName?: string; input?: unknown }[]) => ({ role: 'assistant', parts })
const click = { type: 'tool-computer', input: { action: 'left_click' } }
const navigate = (url: string) => ({ type: 'tool-browser_navigate', input: { url } })

describe('runUsesScreen', () => {
    it('reads only the run since the person last wrote', () => {
        expect(runUsesScreen([user('find them'), assistant(click)])).toBe(true)
        expect(runUsesScreen([user('find them'), assistant(click), user('thanks'), assistant({ type: 'text' })])).toBe(false)
    })

    it('keeps the run going across a takeover handed back', () => {
        expect(runUsesScreen([user('find them'), assistant(click), user(serializeTakeoverResult({ url: 'https://www.linkedin.com/feed/', open: true })), assistant({ type: 'text' })])).toBe(true)
    })

    it('knows the screen tools the CLI bridge prefixed', () => {
        expect(runUsesScreen([user('go'), assistant({ type: 'dynamic-tool', toolName: 'mcp__rerun__computer_open_app' })])).toBe(true)
    })
})

describe('screenSite', () => {
    const messages = [user('go'), assistant(navigate('https://www.pennylane.com/'), click, navigate('https://www.linkedin.com/search/results/people/'))]

    it('names the last site the run opened, without its www', () => {
        expect(screenSite(messages, null)).toBe('linkedin.com')
    })

    it('prefers the site a takeover asks for', () => {
        expect(screenSite(messages, 'https://accounts.google.com/signin')).toBe('accounts.google.com')
    })

    it('has nothing to say about a run that opened no page', () => {
        expect(screenSite([user('go'), assistant(click)], null)).toBeNull()
        expect(screenSite(messages, 'not a url')).toBeNull()
    })
})
