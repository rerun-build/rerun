// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useTranscriptCatchUp } from './useTranscriptCatchUp'

type Message = { id: string; role: 'user' | 'assistant'; parts: { type: 'text'; text: string }[] }

const say = (id: string, role: Message['role'], text: string): Message => ({ id, role, parts: [{ type: 'text', text }] })
const onScreen = [say('u1', 'user', 'Render the teaser'), say('a1', 'assistant', 'It runs, I will tell you.')]
const woken = [...onScreen, say('u2', 'user', '<job_end computer="pc" job="j" state="succeeded">\nDone\n</job_end>'), say('a2', 'assistant', 'The teaser is ready.')]

let root: Root | null = null

async function mount(props: { idle: boolean; messages: Message[]; fetchMessages: () => Promise<unknown[]> }) {
    const setMessages = vi.fn()
    let catchUp: () => Promise<void> = async () => {}
    function Probe() {
        catchUp = useTranscriptCatchUp({ ...props, setMessages })
        return null
    }
    root = createRoot(document.createElement('div'))
    await act(async () => root!.render(createElement(Probe)))
    return { catchUp: () => act(() => catchUp()), setMessages }
}

afterEach(() => {
    act(() => root?.unmount())
    root = null
})

describe('useTranscriptCatchUp', () => {
    it('shows what a run this tab did not start added to the conversation', async () => {
        const { catchUp, setMessages } = await mount({ idle: true, messages: onScreen, fetchMessages: async () => woken })
        await catchUp()
        expect(setMessages).toHaveBeenCalledWith(woken)
    })

    it('counts turns, not messages: the screen may split an answer the transcript keeps whole', async () => {
        const split = [say('u1', 'user', 'Render the teaser'), say('a1', 'assistant', 'Starting.'), say('a1b', 'assistant', 'It runs, I will tell you.')]
        const merged = [say('u1', 'user', 'Render the teaser'), say('a1', 'assistant', 'Starting. It runs, I will tell you.'), say('u2', 'user', '<job_end computer="pc" job="j" state="succeeded">\nDone\n</job_end>'), say('a2', 'assistant', 'Ready.')]
        const { catchUp, setMessages } = await mount({ idle: true, messages: split.concat(say('a1c', 'assistant', '…')), fetchMessages: async () => merged })
        await catchUp()
        expect(setMessages).toHaveBeenCalledWith(merged)
    })

    it('leaves alone a tab that is sending or streaming its own run', async () => {
        const fetchMessages = vi.fn(async () => woken)
        const { catchUp, setMessages } = await mount({ idle: false, messages: onScreen, fetchMessages })
        await catchUp()
        expect(fetchMessages).not.toHaveBeenCalled()
        expect(setMessages).not.toHaveBeenCalled()
    })

    it('keeps the screen when the transcript holds nothing new, or lacks what is on screen', async () => {
        const same = await mount({ idle: true, messages: onScreen, fetchMessages: async () => onScreen })
        await same.catchUp()
        expect(same.setMessages).not.toHaveBeenCalled()
        act(() => root?.unmount())
        const behind = await mount({ idle: true, messages: [...onScreen, say('u3', 'user', 'And the poster?')], fetchMessages: async () => [say('u1', 'user', 'x'), say('a1', 'assistant', 'y'), say('a9', 'assistant', 'z')] })
        await behind.catchUp()
        expect(behind.setMessages).not.toHaveBeenCalled()
    })

    it('shrugs off a transcript that cannot be read', async () => {
        const { catchUp, setMessages } = await mount({ idle: true, messages: onScreen, fetchMessages: () => Promise.reject(new TypeError('Failed to fetch')) })
        await catchUp()
        expect(setMessages).not.toHaveBeenCalled()
    })
})
