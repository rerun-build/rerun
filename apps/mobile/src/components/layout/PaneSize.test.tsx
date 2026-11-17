import { renderHook } from '@testing-library/react-native'
import type { ReactNode } from 'react'
import { Dimensions } from 'react-native'
import { SafeAreaCornerAdaptedInsetsContext, SafeAreaInsetsContext, type CornerAdaptedInsets, type EdgeInsets } from 'react-native-safe-area-context'

import { PaneSizeProvider, usePaneInsets, type PaneSide } from '@/components/layout/PaneSize'
import { isSplit } from '@/components/layout/split'
import { IPAD_FULL_SCREEN_CORNER_INSETS, IPAD_FULL_SCREEN_INSETS, IPAD_WINDOWED_CORNER_INSETS, IPAD_WINDOWED_INSETS, IPHONE_CORNER_INSETS, IPHONE_INSETS } from '@/test/window-controls'

jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default)

function inScreen(insets: EdgeInsets, cornerInsets: CornerAdaptedInsets, side: PaneSide | null = null) {
    return function Screen({ children }: { children: ReactNode }) {
        return (
            <SafeAreaInsetsContext.Provider value={insets}>
                <SafeAreaCornerAdaptedInsetsContext.Provider value={cornerInsets}>{side ? <PaneSizeProvider side={side}>{children}</PaneSizeProvider> : children}</SafeAreaCornerAdaptedInsetsContext.Provider>
            </SafeAreaInsetsContext.Provider>
        )
    }
}

const inWindow = (side: PaneSide | null = null) => inScreen(IPAD_WINDOWED_INSETS, IPAD_WINDOWED_CORNER_INSETS, side)

describe('usePaneInsets in an iPad window', () => {
    it('clears the window controls for a top bar', async () => {
        const { result } = await renderHook(() => usePaneInsets({ clearWindowControls: true }), { wrapper: inWindow() })
        expect(result.current).toEqual({ left: 66, right: 0 })
    })

    it('leaves the content where it was', async () => {
        const { result } = await renderHook(() => usePaneInsets(), { wrapper: inWindow() })
        expect(result.current).toEqual({ left: 0, right: 0 })
    })

    it('clears them in the sidebar, which touches the left edge', async () => {
        const { result } = await renderHook(() => usePaneInsets({ clearWindowControls: true }), { wrapper: inWindow('sidebar') })
        expect(result.current).toEqual({ left: 66, right: 0 })
    })

    it('adds nothing to the detail column beside the sidebar', async () => {
        expect(isSplit(Dimensions.get('window').width)).toBe(true)
        const { result } = await renderHook(() => usePaneInsets({ clearWindowControls: true }), { wrapper: inWindow('detail') })
        expect(result.current).toEqual({ left: 0, right: 0 })
    })
})

describe('usePaneInsets without window controls', () => {
    it('leaves an iPhone top bar where it was, away from the rounded corners', async () => {
        const { result } = await renderHook(() => usePaneInsets({ clearWindowControls: true }), { wrapper: inScreen(IPHONE_INSETS, IPHONE_CORNER_INSETS) })
        expect(result.current).toEqual({ left: 0, right: 0 })
    })

    it('leaves the sidebar of a full-screen iPad where it was', async () => {
        const { result } = await renderHook(() => usePaneInsets({ clearWindowControls: true }), { wrapper: inScreen(IPAD_FULL_SCREEN_INSETS, IPAD_FULL_SCREEN_CORNER_INSETS, 'sidebar') })
        expect(result.current).toEqual({ left: 0, right: 0 })
    })
})
