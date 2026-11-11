import { act, renderHook } from '@testing-library/react-native'
import { BackHandler } from 'react-native'

import { useIntake } from './useIntake'

describe('useIntake', () => {
    it('guesses the industry from the site and hands the site over', async () => {
        const decideIndustry = jest.fn(async () => 'saas' as const)
        const submit = jest.fn(async () => {})
        const { result } = await renderHook(() => useIntake({ knownFirstName: null, decideIndustry, submit }))

        await act(async () => result.current.set({ companyUrl: 'rerun.build' }))
        await act(async () => result.current.next())
        expect(decideIndustry).toHaveBeenCalledWith('rerun.build')
        await act(async () => {})
        expect(result.current.step).toBe('role')

        await act(async () => result.current.choose({ position: 'Founder / CEO' }))
        await act(async () => result.current.set({ firstName: 'Clement' }))
        await act(async () => result.current.next())
        expect(submit).toHaveBeenCalledWith(expect.objectContaining({ companyUrl: 'rerun.build', position: 'Founder / CEO', firstName: 'Clement', decidedIndustry: 'saas' }))
    })

    it("steps back on Android's back gesture instead of leaving the app, and lets it through on the first step", async () => {
        type BackListener = Parameters<typeof BackHandler.addEventListener>[1]
        let listeners: BackListener[] = []
        jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, listener) => {
            listeners.push(listener)
            return { remove: () => (listeners = listeners.filter(registered => registered !== listener)) }
        })
        const pressBack = () => listeners.toReversed().some(listener => listener({} as Parameters<BackListener>[0]))
        const { result } = await renderHook(() => useIntake({ knownFirstName: null, decideIndustry: async () => 'saas' as const, submit: async () => {} }))
        expect(pressBack()).toBe(false)

        await act(async () => result.current.set({ companyUrl: 'rerun.build' }))
        await act(async () => result.current.next())
        await act(async () => {})
        expect(result.current.step).toBe('role')

        let handled = false
        await act(async () => {
            handled = pressBack()
        })
        expect(handled).toBe(true)
        expect(result.current.step).toBe('company')
        jest.restoreAllMocks()
    })
})
