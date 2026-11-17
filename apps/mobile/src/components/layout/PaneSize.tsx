import { createContext, useContext, useState, type ReactNode } from 'react'
import { useWindowDimensions, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { isSplit } from '@/components/layout/split'

export type PaneSize = { width: number; height: number }
export type PaneSide = 'sidebar' | 'detail'

const PaneSizeContext = createContext<PaneSize | null>(null)
const PaneSideContext = createContext<PaneSide | null>(null)

// The size of the pane a screen is drawn in: the detail column beside the sidebar, a sheet on an iPad.
// Outside any pane it is the window, which on an iPhone is the same thing.
export function usePaneSize(): PaneSize {
    const window = useWindowDimensions()
    const pane = useContext(PaneSizeContext)
    return pane ?? { width: window.width, height: window.height }
}

export function useIsSplit(): boolean {
    const { width } = useWindowDimensions()
    return isSplit(width)
}

// The horizontal safe-area insets a screen owes to the window edges it actually touches: the sidebar
// never touches the right edge, the detail column beside it never touches the left one.
// A top bar asks to `clearWindowControls`: iPadOS 26 counts the controls of a windowed app only in the
// corner-adapted insets, never in the regular ones. Those insets also carry the screen's rounded corners on
// both sides (18 on an iPhone, 9.5 on a full-screen iPad), so they are read only while the controls are
// there, which is when the vertical one grows past the top.
export function usePaneInsets({ clearWindowControls = false }: { clearWindowControls?: boolean } = {}): { left: number; right: number } {
    const regular = useSafeAreaInsets()
    const besideControls = useSafeAreaInsets({ cornerAdaptation: 'horizontal' })
    const belowControls = useSafeAreaInsets({ cornerAdaptation: 'vertical' })
    const windowControlsShown = belowControls.top > regular.top
    const left = clearWindowControls && windowControlsShown ? besideControls.left : regular.left
    const right = regular.right
    const side = useContext(PaneSideContext)
    const split = useIsSplit()
    if (side === 'sidebar') return { left, right: 0 }
    if (side === 'detail' && split) return { left: 0, right }
    return { left, right }
}

export function PaneSizeProvider({ children, side = null, style }: { children: ReactNode; side?: PaneSide | null; style?: StyleProp<ViewStyle> }) {
    const [size, setSize] = useState<PaneSize | null>(null)
    const onLayout = (event: LayoutChangeEvent) => {
        const { width, height } = event.nativeEvent.layout
        setSize(current => (current?.width === width && current.height === height ? current : { width, height }))
    }
    return (
        <View style={[{ flex: 1 }, style]} onLayout={onLayout}>
            <PaneSideContext.Provider value={side}>
                <PaneSizeContext.Provider value={size}>{children}</PaneSizeContext.Provider>
            </PaneSideContext.Provider>
        </View>
    )
}
