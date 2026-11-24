import { useRef } from 'react'
import { I18nManager } from 'react-native'

// React Native mirrors rows and `left`/`right` right to left, never a `translateX`, a drag's
// `translationX` nor a scroll offset: those still count from the left of the screen.
export const RIGHT_TO_LEFT = I18nManager.isRTL
export const READING_SIGN = RIGHT_TO_LEFT ? -1 : 1

type HorizontalScroll = { contentOffset: { x: number }; contentSize: { width: number }; layoutMeasurement: { width: number } }

/** How far a horizontal scroll is from the reading start, its first page. */
export function offsetFromStart({ contentOffset, contentSize, layoutMeasurement }: HorizontalScroll): number {
    'worklet'
    return RIGHT_TO_LEFT ? contentSize.width - layoutMeasurement.width - contentOffset.x : contentOffset.x
}

/** The offset that shows page `index` of `count`, as `scrollTo` takes it. */
export function offsetOfPage(index: number, width: number, count: number): number {
    return (RIGHT_TO_LEFT ? count - 1 - index : index) * width
}

/**
 * The `onContentSizeChange` of a pager that opens on another page than the first. Left to right its
 * `contentOffset` does it, but iOS and Android do not count that prop from the same side right to left.
 */
export function usePagePlacement(width: number, place: () => void): (() => void) | undefined {
    const placedWidth = useRef(0)
    if (!RIGHT_TO_LEFT) return undefined
    return () => {
        if (placedWidth.current === width) return
        placedWidth.current = width
        place()
    }
}
