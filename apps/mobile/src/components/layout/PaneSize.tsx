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
export function usePaneInsets(): { left: number; right: number } {
    const { left, right } = useSafeAreaInsets()
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
