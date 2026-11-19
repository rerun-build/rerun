import { act, renderHook } from '@testing-library/react-native'

import { EARLIER_STEP, OPENING_MESSAGES, transcriptRanges, useTranscriptWindow } from './transcript-window'

type Thread = { id: string }[]
const thread = (count: number, prefix = 'm'): Thread => Array.from({ length: count }, (_, index) => ({ id: `${prefix}${index}` }))

describe('the window of a transcript', () => {
    it('opens on the last messages of a long thread', async () => {
        const { result } = await renderHook(() => useTranscriptWindow(thread(200)))
        expect(result.current.recent).toEqual({ key: `m${200 - OPENING_MESSAGES}`, from: 200 - OPENING_MESSAGES, to: 200 })
        expect(result.current.earlier).toEqual([])
        expect(result.current.hasEarlier).toBe(true)
    })

    it('shows a short thread whole', async () => {
        const { result } = await renderHook(() => useTranscriptWindow(thread(12)))
        expect(result.current.recent).toEqual({ key: 'm0', from: 0, to: 12 })
        expect(result.current.hasEarlier).toBe(false)
    })

    it('adds an earlier stretch above, leaving the one on screen as it was', async () => {
        const { result } = await renderHook(() => useTranscriptWindow(thread(200)))
        await act(async () => result.current.showEarlier())
        const opening = 200 - OPENING_MESSAGES
        expect(result.current.earlier).toEqual([{ key: `m${opening - EARLIER_STEP}`, from: opening - EARLIER_STEP, to: opening }])
        expect(result.current.recent).toEqual({ key: `m${opening}`, from: opening, to: 200 })
    })

    it('keeps its stretches where they were as messages arrive at the end', async () => {
        const { result, rerender } = await renderHook(({ messages }: { messages: Thread }) => useTranscriptWindow(messages), { initialProps: { messages: thread(200) } })
        await rerender({ messages: thread(203) })
        expect(result.current.recent).toEqual({ key: `m${200 - OPENING_MESSAGES}`, from: 200 - OPENING_MESSAGES, to: 203 })
    })

    it('opens on the end again when the messages a stretch started at are gone', async () => {
        const { result, rerender } = await renderHook(({ messages }: { messages: Thread }) => useTranscriptWindow(messages), { initialProps: { messages: thread(200) } })
        await rerender({ messages: thread(50, 'other') })
        expect(result.current.recent).toEqual({ key: `other${50 - OPENING_MESSAGES}`, from: 50 - OPENING_MESSAGES, to: 50 })
    })

    it('reads stretches out of order as none', () => {
        expect(transcriptRanges(thread(10), ['m5', 'm2'])).toBeNull()
        expect(transcriptRanges(thread(10), ['m2', 'm5'])).toEqual([
            { key: 'm2', from: 2, to: 5 },
            { key: 'm5', from: 5, to: 10 },
        ])
    })
})
