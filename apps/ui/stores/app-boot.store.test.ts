import { beforeEach, describe, expect, it } from 'vitest'

import { useAppBootStore } from './app-boot.store'

const INITIAL = useAppBootStore.getState()

beforeEach(() => {
    useAppBootStore.setState(INITIAL, true)
})

describe('useAppBootStore', () => {
    it('starts with the board not ready and nothing held', () => {
        expect(useAppBootStore.getState()).toMatchObject({ boardReady: false, holds: 0 })
    })

    it('counts every hold until it is released', () => {
        const releaseColumn = useAppBootStore.getState().hold()
        const releaseOther = useAppBootStore.getState().hold()
        expect(useAppBootStore.getState().holds).toBe(2)
        releaseColumn()
        expect(useAppBootStore.getState().holds).toBe(1)
        releaseOther()
        expect(useAppBootStore.getState().holds).toBe(0)
    })
})
