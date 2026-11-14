import { act, renderHook } from '@testing-library/react-native'
import { BackHandler } from 'react-native'

import { useIntake } from './useIntake'

describe('useIntake', () => {
    it('asks the kind first, keeps it over the site and hands the site over', async () => {
        const decideIndustry = jest.fn(async () => 'saas' as const)
        const submit = jest.fn(async () => {})
        const { result } = await renderHook(() => useIntake({ knownFirstName: null, decideIndustry, submit }))

        expect(result.current.step).toBe('industry')
        await act(async () => result.current.choose({ industry: 'studio' }))
        expect(result.current.step).toBe('company')

        await act(async () => result.current.set({ companyUrl: 'rerun.build' }))
        await act(async () => result.current.next())
        expect(decideIndustry).not.toHaveBeenCalled()
        expect(result.current.step).toBe('role')

        await act(async () => result.current.choose({ position: 'Founder / Builder' }))
        await act(async () => result.current.set({ firstName: 'Clement' }))
        await act(async () => result.current.next())
        expect(submit).toHaveBeenCalledWith(expect.objectContaining({ companyUrl: 'rerun.build', industry: 'studio', position: 'Founder / Builder', firstName: 'Clement', decidedIndustry: null }))
    })

    it('guesses the industry from the kind typed under Other, and skips the site', async () => {
        const decideIndustry = jest.fn(async () => 'creators' as const)
        const submit = jest.fn(async () => {})
        const { result } = await renderHook(() => useIntake({ knownFirstName: 'Clement', decideIndustry, submit }))

        await act(async () => result.current.set({ industryLabel: 'Pottery studio' }))
        await act(async () => result.current.next())
        expect(decideIndustry).toHaveBeenCalledWith('Pottery studio')
        await act(async () => {})
        expect(result.current.step).toBe('company')

        await act(async () => result.current.skipWebsite())
        expect(result.current.step).toBe('role')
        await act(async () => result.current.choose({ position: 'Founder / CEO' }))
        expect(submit).toHaveBeenCalledWith(expect.objectContaining({ companyUrl: null, industry: null, industryLabel: 'Pottery studio', decidedIndustry: 'creators' }))
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

        await act(async () => result.current.choose({ industry: 'studio' }))
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
