import { createContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { View } from 'react-native'
import { Gesture, GestureDetector, type GestureType } from 'react-native-gesture-handler'
import Animated, { useAnimatedReaction, useAnimatedRef, useAnimatedScrollHandler, useReducedMotion, useSharedValue, type SharedValue } from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'

import * as Haptics from '@/lib/haptics'
import { offsetFromStart, offsetOfPage, RIGHT_TO_LEFT, usePagePlacement } from '@/lib/reading-direction'

import type { ConversationPage } from './conversation-pages'

// How far past the first or the last page, in pages, a drag goes before it bumps into the end of the row.
const EDGE_BUMP = 0.08
// The page opened is drawn alone while the screen slides in; its neighbours come once it is in place,
// or as soon as a finger starts to drag.
const NEIGHBOURS_AFTER_MS = 450

// The pager's own swipe, for a gesture inside a page that must win over it: a bubble swiped to quote it.
export const PagerGestureContext = createContext<GestureType | null>(null)

const tickOnto = (draft: boolean) => (draft ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light) : Haptics.selectionAsync())
const bumpIntoEdge = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft)

type ConversationPagerProps = {
    pages: ConversationPage[]
    activeIndex: number
    // Written here, in pages: the header's chips read it to slide with the finger.
    progress: SharedValue<number>
    onSettle: (index: number) => void
    renderPage: (page: ConversationPage, onScreen: boolean) => ReactNode
}

// The coworker's conversations side by side, swiped through as the header's tabs. The page on screen
// and its two neighbours are mounted, so a drag already shows the next transcript, and a page once
// drawn stays drawn: coming back to it is instant.
export function ConversationPager({ pages, activeIndex, progress, onSettle, renderPage }: ConversationPagerProps) {
    const scroll = useAnimatedRef<Animated.ScrollView>()
    const pagerGesture = useMemo(() => Gesture.Native(), [])
    const reduceMotion = useReducedMotion()
    // `offset` is where the row sits when it mounts or resizes. Fabric moves the native view the
    // moment the `contentOffset` prop changes, so it only follows the layout: a tab picked scrolls on its own.
    const [size, setSize] = useState({ width: 0, height: 0, offset: 0 })
    const pageWidth = useSharedValue(0)
    const dragging = useSharedValue(false)
    const restingIndex = useRef(activeIndex)
    const restingKey = useRef(pages[activeIndex]?.key)
    const lastIndex = pages.length - 1
    const [neighboursShown, setNeighboursShown] = useState(false)
    const [visited, setVisited] = useState<ReadonlySet<string>>(() => new Set())
    const activeKey = pages[activeIndex]?.key
    if (activeKey && !visited.has(activeKey)) setVisited(new Set(visited).add(activeKey))
    useEffect(() => {
        const timer = setTimeout(() => setNeighboursShown(true), NEIGHBOURS_AFTER_MS)
        return () => clearTimeout(timer)
    }, [])
    const mounted = (page: ConversationPage, index: number) => visited.has(page.key) || (neighboursShown && Math.abs(index - activeIndex) <= 1)

    // A tab picked in the header slides there, even one just added before the draft. Tabs read late
    // from the device shift the row under the resting page, and the pager jumps to stay on the same
    // conversation.
    useEffect(() => {
        const rowStable = pages[restingIndex.current]?.key === restingKey.current
        restingKey.current = pages[activeIndex]?.key
        if (!size.width) {
            restingIndex.current = activeIndex
            progress.set(activeIndex)
            return
        }
        if (restingIndex.current === activeIndex) return
        restingIndex.current = activeIndex
        const slides = rowStable && !reduceMotion
        if (!slides) progress.set(activeIndex)
        scroll.current?.scrollTo({ x: offsetOfPage(activeIndex, size.width, pages.length), animated: slides })
    }, [activeIndex, pages, size.width, reduceMotion, progress, scroll])

    const placePage = usePagePlacement(size.width, () => scroll.current?.scrollTo({ x: offsetOfPage(restingIndex.current, size.width, pages.length), animated: false }))

    const settle = (offset: number) => {
        const index = Math.round(offset / size.width)
        restingIndex.current = index
        restingKey.current = pages[index]?.key
        if (index !== activeIndex) onSettle(index)
    }

    const onScroll = useAnimatedScrollHandler({
        onScroll: event => {
            if (pageWidth.value > 0) progress.set(offsetFromStart(event) / pageWidth.value)
        },
        onBeginDrag: () => {
            dragging.value = true
            scheduleOnRN(setNeighboursShown, true)
        },
        onMomentumEnd: event => {
            dragging.value = false
            scheduleOnRN(settle, offsetFromStart(event))
        },
    })

    // Only the finger ticks: a tab picked in the header slides across the row in silence.
    useAnimatedReaction(
        () => Math.round(progress.value),
        (nearest, previous) => {
            if (previous === null || nearest === previous || !dragging.value || nearest < 0 || nearest > lastIndex) return
            scheduleOnRN(tickOnto, nearest === lastIndex)
        },
        [lastIndex]
    )

    useAnimatedReaction(
        () => progress.value < -EDGE_BUMP || progress.value > lastIndex + EDGE_BUMP,
        (pastEdge, wasPastEdge) => {
            if (pastEdge && wasPastEdge === false && dragging.value) scheduleOnRN(bumpIntoEdge)
        },
        [lastIndex]
    )

    return (
        <View
            style={{ flex: 1 }}
            onLayout={({ nativeEvent: { layout } }) => {
                pageWidth.value = layout.width
                setSize(known => (known.width === layout.width && known.height === layout.height ? known : { width: layout.width, height: layout.height, offset: restingIndex.current * layout.width }))
            }}
        >
            {size.width > 0 && (
                <PagerGestureContext value={pagerGesture}>
                    <GestureDetector gesture={pagerGesture}>
                        <Animated.ScrollView
                            ref={scroll}
                            horizontal
                            pagingEnabled
                            showsHorizontalScrollIndicator={false}
                            keyboardDismissMode="on-drag"
                            keyboardShouldPersistTaps="handled"
                            scrollsToTop={false}
                            scrollEventThrottle={16}
                            contentOffset={RIGHT_TO_LEFT ? undefined : { x: size.offset, y: 0 }}
                            onContentSizeChange={placePage}
                            onScroll={onScroll}
                        >
                            {pages.map((page, index) => {
                                const onScreen = index === activeIndex
                                return (
                                    <View key={page.key} accessibilityElementsHidden={!onScreen} importantForAccessibility={onScreen ? 'auto' : 'no-hide-descendants'} style={{ width: size.width, height: size.height, overflow: 'hidden' }}>
                                        {mounted(page, index) && renderPage(page, onScreen)}
                                    </View>
                                )
                            })}
                        </Animated.ScrollView>
                    </GestureDetector>
                </PagerGestureContext>
            )}
        </View>
    )
}
