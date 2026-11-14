import { useEffect, useRef, useState, type ReactNode } from 'react'
import { View } from 'react-native'
import Animated, { useAnimatedReaction, useAnimatedRef, useAnimatedScrollHandler, useReducedMotion, useSharedValue, type SharedValue } from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'

import * as Haptics from '@/lib/haptics'

import type { ConversationPage } from './conversation-pages'

const EDGE_BUMP = 0.08

const tickOnto = (draft: boolean) => (draft ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light) : Haptics.selectionAsync())
const bumpIntoEdge = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft)

type ConversationPagerProps = {
    pages: ConversationPage[]
    activeIndex: number
    progress: SharedValue<number>
    onSettle: (index: number) => void
    renderPage: (page: ConversationPage, onScreen: boolean) => ReactNode
}

export function ConversationPager({ pages, activeIndex, progress, onSettle, renderPage }: ConversationPagerProps) {
    const scroll = useAnimatedRef<Animated.ScrollView>()
    const reduceMotion = useReducedMotion()
    const [size, setSize] = useState({ width: 0, height: 0, offset: 0 })
    const pageWidth = useSharedValue(0)
    const dragging = useSharedValue(false)
    const restingIndex = useRef(activeIndex)
    const restingKey = useRef(pages[activeIndex]?.key)
    const lastIndex = pages.length - 1

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
        scroll.current?.scrollTo({ x: activeIndex * size.width, animated: slides })
    }, [activeIndex, pages, size.width, reduceMotion, progress, scroll])

    const settle = (offset: number) => {
        const index = Math.round(offset / size.width)
        restingIndex.current = index
        restingKey.current = pages[index]?.key
        if (index !== activeIndex) onSettle(index)
    }

    const onScroll = useAnimatedScrollHandler({
        onScroll: event => {
            if (pageWidth.value > 0) progress.set(event.contentOffset.x / pageWidth.value)
        },
        onBeginDrag: () => {
            dragging.value = true
        },
        onMomentumEnd: event => {
            dragging.value = false
            scheduleOnRN(settle, event.contentOffset.x)
        },
    })

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
                <Animated.ScrollView
                    ref={scroll}
                    horizontal
                    pagingEnabled
                    showsHorizontalScrollIndicator={false}
                    keyboardDismissMode="on-drag"
                    keyboardShouldPersistTaps="handled"
                    scrollsToTop={false}
                    scrollEventThrottle={16}
                    contentOffset={{ x: size.offset, y: 0 }}
                    onScroll={onScroll}
                >
                    {pages.map((page, index) => {
                        const onScreen = index === activeIndex
                        return (
                            <View key={page.key} accessibilityElementsHidden={!onScreen} importantForAccessibility={onScreen ? 'auto' : 'no-hide-descendants'} style={{ width: size.width, height: size.height, overflow: 'hidden' }}>
                                {Math.abs(index - activeIndex) <= 1 && renderPage(page, onScreen)}
                            </View>
                        )
                    })}
                </Animated.ScrollView>
            )}
        </View>
    )
}
