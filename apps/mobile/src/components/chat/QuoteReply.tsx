import { QUOTE_FROM_USER, quotePreview, type MessageQuote } from '@rerun/contracts'
import { createContext, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Pressable, StyleSheet, View, type ScrollViewInstance, type ViewInstance } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { FadeIn, FadeInDown, FadeOut, FadeOutDown, interpolate, interpolateColor, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { useTranslations } from 'use-intl'

import { PagerGestureContext } from './ConversationPager'

import { useGlassStyle } from '@/components/ui/GlassButton'
import { GlassSurface } from '@/components/ui/GlassSurface'
import { AppText } from '@/components/ui/AppText'
import { Icon } from '@/components/ui/Icon'
import * as Haptics from '@/lib/haptics'
import { useStableCallback } from '@/lib/use-stable-callback'
import { useTheme } from '@/theme/theme'
import { brand, radius, spacing, withAlpha } from '@/theme/tokens'

import { GLASS_SHADOW, GLASS_TINT_ALPHA } from './glass'

// The web's thresholds (components/chat/quote/QuotableBubble.tsx): armed at 56, resisting past 72.
const SWIPE_ARMED = 56
const SWIPE_FREE = 72
const SWIPE_RESISTANCE = 0.2
const SWIPE_ACTIVATE = 10
const SOURCE_FLASH_MS = 1600

export type QuoteSide = 'user' | 'assistant'

/** A bubble on screen, as a sent quote looks for its source. */
export type QuoteSourceEntry = { messageId: string; text: string; view: ViewInstance | null; flash: () => void }

type QuoteReply = {
    quote: (side: QuoteSide, messageId: string, text: string) => void
    showSource: (quote: MessageQuote) => void
    register: (key: string, entry: () => QuoteSourceEntry) => () => void
}

// What the bubbles of a conversation reach to start a reply. Absent in the Chief of Staff's thread:
// the bubbles then do nothing on a swipe.
export const QuoteReplyContext = createContext<QuoteReply | null>(null)

export function useQuoteAuthor(): (quote: MessageQuote) => string {
    const t = useTranslations('mobileChat.quote')
    return quote => (quote.from === QUOTE_FROM_USER ? t('you') : quote.from)
}

const compact = (text: string) => text.replace(/\s+/g, '')

// The bubble a sent quote came from among those drawn: the one of its message holding the passage,
// else any holding it (a message streamed in this launch takes its engine id once read back).
export function findQuoteSource(entries: QuoteSourceEntry[], quote: MessageQuote): QuoteSourceEntry | null {
    const passage = compact(quote.text)
    const holds = (entry: QuoteSourceEntry) => compact(entry.text).includes(passage)
    return entries.find(entry => entry.messageId === quote.messageId && holds(entry)) ?? entries.find(holds) ?? entries.find(entry => entry.messageId === quote.messageId) ?? null
}

type UseQuoteReplyOptions = {
    /** Off in the Chief of Staff's thread: its bubbles offer nothing. */
    enabled: boolean
    /** Who wrote the passage, as the coworker reads it: QUOTE_FROM_USER for the person who quotes it. */
    authorOf: (side: QuoteSide, messageId: string) => string
    scroll: RefObject<ScrollViewInstance | null>
    /** Where the thread is scrolled to, its content offset, read at the tap. */
    scrollOffset: RefObject<number>
    /** The thread lets go of its end before it scrolls back to a source. */
    onLeaveEnd: () => void
    focusComposer: () => void
}

// The one passage the next message replies to: swiped from a bubble, replaced by the next one, sent
// at the head of the message. Its sources are the bubbles on screen, registered by SwipeToQuote.
export function useQuoteReply({ enabled, authorOf, scroll, scrollOffset, onLeaveEnd, focusComposer }: UseQuoteReplyOptions) {
    const [quote, setQuote] = useState<MessageQuote | null>(null)
    const sources = useRef(new Map<string, () => QuoteSourceEntry>())

    // Back to the bubble a sent quote came from, centred, then marked for a moment. A bubble outside
    // the stretch of the thread drawn is not found: nothing moves.
    const showSource = useStableCallback((target: MessageQuote) => {
        const source = findQuoteSource([...sources.current.values()].map(entry => entry()), target)
        const thread = scroll.current
        if (!source?.view || !thread) return
        source.view.measureInWindow((_x, y, _width, height) => {
            thread.measureInWindow((_tx, threadY, _threadWidth, threadHeight) => {
                onLeaveEnd()
                thread.scrollTo({ y: Math.max(0, scrollOffset.current + y + height / 2 - (threadY + threadHeight / 2)), animated: true })
                source.flash()
            })
        })
    })
    const take = useStableCallback((side: QuoteSide, messageId: string, text: string) => {
        if (!text.trim()) return
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
        setQuote({ from: authorOf(side, messageId), messageId, text })
        focusComposer()
    })
    const context = useMemo<QuoteReply | null>(
        () =>
            enabled
                ? {
                      quote: take,
                      showSource,
                      register: (key, entry) => {
                          sources.current.set(key, entry)
                          return () => void sources.current.delete(key)
                      },
                  }
                : null,
        [enabled, take, showSource]
    )
    return { quote, setQuote, showSource, context }
}

type SwipeToQuoteProps = { side: QuoteSide; messageId: string; text: string; children: ReactNode }

// One bubble, quoted on its own with a swipe to the right: an arrow comes up behind it, grows with
// the swipe and turns brand once letting go quotes it. A vertical move scrolls the thread.
export function SwipeToQuote({ side, messageId, text, children }: SwipeToQuoteProps) {
    const reply = useContext(QuoteReplyContext)
    const pagerGesture = useContext(PagerGestureContext)
    const key = useId()
    const theme = useTheme()
    const viewRef = useRef<ViewInstance>(null)
    const offset = useSharedValue(0)
    const armed = useSharedValue(false)
    const [flashing, setFlashing] = useState(false)
    const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

    const latest = useRef({ messageId, text })
    useEffect(() => {
        latest.current = { messageId, text }
    }, [messageId, text])

    useEffect(() => {
        if (!reply) return
        const flash = () => {
            setFlashing(true)
            if (flashTimer.current) clearTimeout(flashTimer.current)
            flashTimer.current = setTimeout(() => setFlashing(false), SOURCE_FLASH_MS)
        }
        const unregister = reply.register(key, () => ({ ...latest.current, view: viewRef.current, flash }))
        return () => {
            unregister()
            if (flashTimer.current) clearTimeout(flashTimer.current)
        }
    }, [reply, key])

    const quote = () => messageId && reply?.quote(side, messageId, text)
    const armedTick = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)

    // Started on a bubble, a swipe to the right quotes it rather than turning the pager back to the
    // previous conversation; to the left, it fails at once and leaves the pager its swipe.
    const pan = Gesture.Pan()
        .enabled(!!reply && !!messageId && !!text.trim())
        .activeOffsetX(SWIPE_ACTIVATE)
        .failOffsetX(-SWIPE_ACTIVATE)
        .failOffsetY([-SWIPE_ACTIVATE, SWIPE_ACTIVATE])
        .onUpdate(event => {
            const pulled = Math.max(0, event.translationX)
            const next = pulled <= SWIPE_FREE ? pulled : SWIPE_FREE + (pulled - SWIPE_FREE) * SWIPE_RESISTANCE
            const nowArmed = next >= SWIPE_ARMED
            if (nowArmed && !armed.value) runOnJS(armedTick)()
            armed.value = nowArmed
            offset.value = next
        })
        .onEnd(() => {
            if (armed.value) runOnJS(quote)()
        })
        .onFinalize(() => {
            armed.value = false
            offset.value = withTiming(0, { duration: 220 })
        })
    if (pagerGesture) pan.blocksExternalGesture(pagerGesture)

    const bubbleStyle = useAnimatedStyle(() => ({ transform: [{ translateX: offset.value }] }))
    const hintStyle = useAnimatedStyle(() => {
        const shown = Math.min(offset.value / SWIPE_ARMED, 1)
        return { opacity: shown, transform: [{ translateY: -14 }, { scale: 0.6 + shown * 0.4 }], backgroundColor: interpolateColor(offset.value, [SWIPE_ARMED - 1, SWIPE_ARMED], [theme.muted, brand.base]) }
    })
    const mutedIconStyle = useAnimatedStyle(() => ({ opacity: interpolate(offset.value, [SWIPE_ARMED - 1, SWIPE_ARMED], [1, 0], 'clamp') }))
    const armedIconStyle = useAnimatedStyle(() => ({ opacity: interpolate(offset.value, [SWIPE_ARMED - 1, SWIPE_ARMED], [0, 1], 'clamp') }))

    return (
        <View style={{ alignSelf: 'stretch', flexDirection: 'row', justifyContent: side === 'user' ? 'flex-end' : 'flex-start' }}>
            {reply && (
                <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 4, top: '50%', width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, hintStyle]}>
                    <Animated.View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }, mutedIconStyle]}>
                        <Icon name="reply" size={14} color={theme.mutedForeground} />
                    </Animated.View>
                    <Animated.View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }, armedIconStyle]}>
                        <Icon name="reply" size={14} color="#ffffff" />
                    </Animated.View>
                </Animated.View>
            )}
            <GestureDetector gesture={pan}>
                <Animated.View ref={viewRef} collapsable={false} style={[{ maxWidth: '100%' }, bubbleStyle]}>
                    {children}
                    {flashing && <Animated.View entering={FadeIn.duration(150)} exiting={FadeOut.duration(400)} pointerEvents="none" style={{ ...StyleSheet.absoluteFill, borderRadius: radius.xl, backgroundColor: withAlpha(brand.base, 0.12) }} />}
                </Animated.View>
            </GestureDetector>
        </View>
    )
}

// Over the composer while a reply quotes a passage, the shape of the queued message: the passage on
// one line, a tap leads back to it, ✕ drops it.
export function QuoteBanner({ quote, onShowSource, onRemove }: { quote: MessageQuote; onShowSource: () => void; onRemove: () => void }) {
    const theme = useTheme()
    const glass = useGlassStyle()
    const t = useTranslations('mobileChat.quote')
    const authorOf = useQuoteAuthor()
    const accent = theme.scheme === 'dark' ? brand.soft : brand.base
    return (
        <Animated.View entering={FadeInDown.duration(200)} exiting={FadeOutDown.duration(200)} style={{ paddingHorizontal: spacing.md }}>
            <GlassSurface key={theme.scheme} colorScheme={theme.scheme} glassEffectStyle={glass} tintColor={withAlpha(theme.card, GLASS_TINT_ALPHA)} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingLeft: spacing.md, paddingRight: spacing.xs, paddingVertical: 4, borderRadius: radius.lg, borderCurve: 'continuous', borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border, boxShadow: GLASS_SHADOW[theme.scheme] }}>
                <Icon name="quote" size={13} color={accent} />
                <Pressable onPress={onShowSource} accessibilityRole="button" accessibilityLabel={t('showSource')} style={{ flex: 1 }}>
                    <AppText variant="footnote" tone="muted" numberOfLines={1}>
                        <AppText variant="footnote" medium>
                            {authorOf(quote)}
                        </AppText>
                        {` · ${quotePreview(quote.text)}`}
                    </AppText>
                </Pressable>
                <Pressable onPress={onRemove} accessibilityRole="button" accessibilityLabel={t('remove')} hitSlop={6} style={({ pressed }) => ({ width: 30, height: 30, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.5 : 1 })}>
                    <Icon name="x" size={15} bold color={theme.mutedForeground} />
                </Pressable>
            </GlassSurface>
        </Animated.View>
    )
}

// At the top of the person's bubble: the passage the message answers, in the bubble's own ink.
export function QuoteCard({ quote }: { quote: MessageQuote }) {
    const reply = useContext(QuoteReplyContext)
    const t = useTranslations('mobileChat.quote')
    const authorOf = useQuoteAuthor()
    return (
        <Pressable onPress={() => reply?.showSource(quote)} disabled={!reply} accessibilityRole="button" accessibilityLabel={t('showSource')} style={({ pressed }) => ({ marginBottom: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.md, borderLeftWidth: 2, borderLeftColor: 'rgba(255,255,255,0.6)', backgroundColor: pressed ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.15)' })}>
            <AppText variant="caption" medium style={{ color: '#ffffff' }}>
                {authorOf(quote)}
            </AppText>
            <AppText variant="caption" numberOfLines={2} style={{ color: '#ffffff', opacity: 0.9 }}>
                {quotePreview(quote.text)}
            </AppText>
        </Pressable>
    )
}
