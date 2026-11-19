import type { RewindPayload } from '@moldwright/contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/app/api/_actions/rewind.actions', () => ({ readRewindAction: vi.fn(), markRewindViewedAction: vi.fn() }))

import { markRewindViewedAction, readRewindAction } from '@/app/api/_actions/rewind.actions'
import { selectHasUnseenLatest, useRewindStore } from './rewind.store'

const payloadOf = (week: string) => ({ weekStart: week }) as unknown as RewindPayload

function deferred<T>() {
    let resolve!: (value: T) => void
    const promise = new Promise<T>(r => (resolve = r))
    return { promise, resolve }
}

beforeEach(() => {
    vi.mocked(readRewindAction).mockReset()
    vi.mocked(markRewindViewedAction).mockReset().mockResolvedValue(undefined as never)
    useRewindStore.setState({ weeks: [], payloads: {}, shown: null, loadingWeek: null })
    useRewindStore.getState().setWeeks([
        { id: 'w2', weekStart: '2026-09-21', viewed: false },
        { id: 'w1', weekStart: '2026-09-14', viewed: true },
    ])
})

describe('openWeek', () => {
    it('shows the week, caches it and marks it viewed once', async () => {
        vi.mocked(readRewindAction).mockResolvedValue(payloadOf('w2') as never)
        await useRewindStore.getState().openWeek('w2')
        const state = useRewindStore.getState()
        expect(state.shown).toEqual({ id: 'w2', payload: payloadOf('w2') })
        expect(state.loadingWeek).toBeNull()
        expect(state.weeks[0].viewed).toBe(true)
        expect(markRewindViewedAction).toHaveBeenCalledWith('w2')

        await useRewindStore.getState().openWeek('w2')
        expect(readRewindAction).toHaveBeenCalledTimes(1)
        expect(markRewindViewedAction).toHaveBeenCalledTimes(1)
    })

    it('does not mark a week already viewed', async () => {
        vi.mocked(readRewindAction).mockResolvedValue(payloadOf('w1') as never)
        await useRewindStore.getState().openWeek('w1')
        expect(markRewindViewedAction).not.toHaveBeenCalled()
    })

    it('lets a later pick win over a read that comes back late', async () => {
        const slow = deferred<RewindPayload | null>()
        vi.mocked(readRewindAction).mockImplementation(id => (id === 'w2' ? (slow.promise as never) : (Promise.resolve(payloadOf('w1')) as never)))
        const first = useRewindStore.getState().openWeek('w2')
        await useRewindStore.getState().openWeek('w1')
        slow.resolve(payloadOf('w2'))
        await first
        expect(useRewindStore.getState().shown?.id).toBe('w1')
        expect(useRewindStore.getState().payloads).not.toHaveProperty('w2')
    })

    it('lets a close win over a read that comes back late', async () => {
        const slow = deferred<RewindPayload | null>()
        vi.mocked(readRewindAction).mockReturnValue(slow.promise as never)
        const opening = useRewindStore.getState().openWeek('w2')
        useRewindStore.getState().closeRewind()
        slow.resolve(payloadOf('w2'))
        await opening
        expect(useRewindStore.getState().shown).toBeNull()
    })

    it('stops loading and shows nothing when the read fails', async () => {
        vi.mocked(readRewindAction).mockRejectedValue(new Error('offline'))
        await useRewindStore.getState().openWeek('w2')
        expect(useRewindStore.getState()).toMatchObject({ shown: null, loadingWeek: null })
        expect(useRewindStore.getState().weeks[0].viewed).toBe(false)
    })
})

describe('openLatest and selectHasUnseenLatest', () => {
    it('opens the newest week and reports it unseen until then', async () => {
        vi.mocked(readRewindAction).mockResolvedValue(payloadOf('w2') as never)
        expect(selectHasUnseenLatest(useRewindStore.getState())).toBe(true)
        useRewindStore.getState().openLatest()
        await vi.waitFor(() => expect(useRewindStore.getState().shown?.id).toBe('w2'))
        expect(selectHasUnseenLatest(useRewindStore.getState())).toBe(false)
    })

    it('does nothing without weeks', () => {
        useRewindStore.getState().setWeeks([])
        useRewindStore.getState().openLatest()
        expect(readRewindAction).not.toHaveBeenCalled()
        expect(selectHasUnseenLatest(useRewindStore.getState())).toBe(false)
    })

    it('forgets the cached stories when the weeks are replaced', async () => {
        vi.mocked(readRewindAction).mockResolvedValue(payloadOf('w2') as never)
        await useRewindStore.getState().openWeek('w2')
        useRewindStore.getState().setWeeks([{ id: 'w2', weekStart: '2026-09-21', viewed: true }])
        expect(useRewindStore.getState().payloads).toEqual({})
    })
})
