import * as Haptics from 'expo-haptics'
import { useEffect, useState, type ReactNode } from 'react'
import { Pressable, View } from 'react-native'
import { useTranslations } from 'use-intl'
import Animated, { interpolateColor, useAnimatedRef, useAnimatedScrollHandler, useAnimatedStyle, useReducedMotion, useSharedValue, type SharedValue } from 'react-native-reanimated'

import { AppText } from '@/components/ui/AppText'
import { Icon } from '@/components/ui/Icon'
import { useTheme } from '@/theme/theme'
import { spacing, withAlpha } from '@/theme/tokens'

const MAX_DOTS = 6
const DOT = 8
const DOT_GAP = 6
const HALO = DOT + 6
const DOTS_INSET = 4
const CHEVRON = 28

function Chevron({ direction, disabled, onPress }: { direction: 'left' | 'right'; disabled: boolean; onPress: () => void }) {
    const t = useTranslations('mobileHitl.steps')
    const theme = useTheme()
    return (
        <Pressable
            onPress={onPress}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={direction === 'left' ? t('previous') : t('next')}
            accessibilityState={{ disabled }}
            hitSlop={6}
            style={({ pressed }) => ({ width: CHEVRON, height: CHEVRON, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.35 : pressed ? 0.5 : 1 })}
        >
            <Icon name={direction === 'left' ? 'chevron-left' : 'chevron-right'} size={12} bold color={theme.mutedForeground} />
        </Pressable>
    )
}

function Dot({ at, count, answered, progress, onPick }: { at: number; count: number; answered: boolean; progress: SharedValue<number>; onPick: (index: number) => void }) {
    const t = useTranslations('mobileHitl.steps')
    const theme = useTheme()
    const faint = withAlpha(theme.mutedForeground, 0.4)
    const rest = answered ? theme.foreground : faint
    const ring = useAnimatedStyle(() => ({ borderColor: interpolateColor(Math.max(0, 1 - Math.abs(progress.value - at)), [0, 1], [rest, theme.foreground]) }))
    const fill = useAnimatedStyle(() => ({ opacity: answered ? Math.min(1, Math.abs(progress.value - at)) : 0 }))
    return (
        <Pressable onPress={() => onPick(at)} accessibilityRole="button" accessibilityLabel={t('goTo', { step: at + 1, count })} hitSlop={{ top: 10, bottom: 10, left: 3, right: 3 }}>
            <Animated.View style={[{ width: DOT, height: DOT, borderRadius: DOT / 2, borderWidth: 1, overflow: 'hidden' }, ring]}>
                <Animated.View style={[{ flex: 1, backgroundColor: theme.foreground }, fill]} />
            </Animated.View>
        </Pressable>
    )
}

// The web's step dots: the current step hollow inside a halo, answered ones filled, the rest faint.
// The halo and the fills follow the pager's offset, so they move under the finger.
function StepDots({ count, current, progress, done, onPick }: { count: number; current: number; progress: SharedValue<number>; done: (index: number) => boolean; onPick: (index: number) => void }) {
    const t = useTranslations('mobileHitl.steps')
    const theme = useTheme()
    const halo = useAnimatedStyle(() => ({ transform: [{ translateX: DOTS_INSET + (DOT - HALO) / 2 + progress.value * (DOT + DOT_GAP) }] }))
    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', marginLeft: -spacing.sm }}>
            <Chevron direction="left" disabled={current === 0} onPress={() => onPick(current - 1)} />
            {count > MAX_DOTS ? (
                <AppText variant="caption" tone="muted" style={{ fontVariant: ['tabular-nums'], minWidth: 36, textAlign: 'center' }}>
                    {t('position', { step: current + 1, count })}
                </AppText>
            ) : (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: DOT_GAP, paddingHorizontal: DOTS_INSET }}>
                    <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 0, top: (DOT - HALO) / 2, width: HALO, height: HALO, borderRadius: HALO / 2, borderWidth: 1, borderColor: withAlpha(theme.foreground, 0.5) }, halo]} />
                    {Array.from({ length: count }, (_, at) => (
                        <Dot key={at} at={at} count={count} answered={done(at)} progress={progress} onPick={onPick} />
                    ))}
                </View>
            )}
            <Chevron direction="right" disabled={current >= count - 1} onPress={() => onPick(current + 1)} />
        </View>
    )
}

type HitlStepsProps = {
    count: number
    index: number
    onIndexChange: (index: number) => void
    done: (index: number) => boolean
    renderStep: (index: number) => ReactNode
    actions?: ReactNode
}

// The steps of a HITL widget as pages swiped sideways, the card's height following the page under the
// finger, with the dots and the widget's actions underneath. A single step is drawn as is.
export function HitlSteps({ count, index, onIndexChange, done, renderStep, actions }: HitlStepsProps) {
    const reduceMotion = useReducedMotion()
    const pager = useAnimatedRef<Animated.ScrollView>()
    const progress = useSharedValue(index)
    const pageWidth = useSharedValue(0)
    const [heights, setHeights] = useState<number[]>([])
    const [width, setWidth] = useState(0)
    const [openedAt] = useState(index)

    const onScroll = useAnimatedScrollHandler(event => {
        if (pageWidth.value > 0) progress.value = event.contentOffset.x / pageWidth.value
    })

    const frame = useAnimatedStyle(() => {
        const measured = heights
        const position = Math.min(Math.max(progress.value, 0), count - 1)
        const from = Math.floor(position)
        const fromHeight = measured[from]
        const toHeight = measured[Math.min(from + 1, count - 1)]
        if (!fromHeight || !toHeight) return {}
        return { height: fromHeight + (toHeight - fromHeight) * (position - from) }
    })

    useEffect(() => {
        if (width > 0) pager.current?.scrollTo({ x: index * width, animated: !reduceMotion })
    }, [index, width, reduceMotion, pager])

    const settle = (offset: number) => {
        if (width <= 0) return
        const reached = Math.round(offset / width)
        if (reached === index || reached < 0 || reached >= count) return
        Haptics.selectionAsync()
        onIndexChange(reached)
    }

    const measure = (at: number, height: number) => {
        setHeights(current => {
            if (current[at] === height) return current
            const next = Array.from({ length: count }, (_, step) => current[step] ?? 0)
            next[at] = height
            return next
        })
    }

    const footer = (count > 1 || actions) && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', rowGap: spacing.sm, columnGap: spacing.sm }}>
            {count > 1 ? <StepDots count={count} current={index} progress={progress} done={done} onPick={onIndexChange} /> : <View />}
            {actions && <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', gap: spacing.sm, marginLeft: 'auto' }}>{actions}</View>}
        </View>
    )

    if (count <= 1) {
        return (
            <View style={{ gap: spacing.md }}>
                {renderStep(0)}
                {footer}
            </View>
        )
    }

    return (
        <View style={{ gap: spacing.md }}>
            <Animated.View
                onLayout={event => {
                    const next = event.nativeEvent.layout.width
                    pageWidth.set(next)
                    setWidth(next)
                }}
                style={[{ marginHorizontal: -spacing.lg, overflow: 'hidden' }, frame]}
            >
                {width > 0 ? (
                    <Animated.ScrollView ref={pager} horizontal pagingEnabled showsHorizontalScrollIndicator={false} scrollEventThrottle={16} onScroll={onScroll} onMomentumScrollEnd={event => settle(event.nativeEvent.contentOffset.x)} contentOffset={{ x: openedAt * width, y: 0 }} contentContainerStyle={{ alignItems: 'flex-start' }}>
                        {Array.from({ length: count }, (_, at) => (
                            <View key={at} accessibilityElementsHidden={at !== index} importantForAccessibility={at === index ? 'auto' : 'no-hide-descendants'} onLayout={event => measure(at, event.nativeEvent.layout.height)} style={{ width, paddingHorizontal: spacing.lg, gap: spacing.md }}>
                                {renderStep(at)}
                            </View>
                        ))}
                    </Animated.ScrollView>
                ) : (
                    <View style={{ paddingHorizontal: spacing.lg, gap: spacing.md }}>{renderStep(index)}</View>
                )}
            </Animated.View>
            {footer}
        </View>
    )
}
