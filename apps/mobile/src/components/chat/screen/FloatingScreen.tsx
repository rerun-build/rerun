import { Image } from 'expo-image'
import { File, Paths } from 'expo-file-system'
import { useState, useSyncExternalStore, type ReactNode } from 'react'
import { View, type LayoutChangeEvent } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { Keyframe, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'
import { useTranslations } from 'use-intl'

import { useTheme } from '@/theme/theme'
import { radius } from '@/theme/tokens'

import { ScreenFace } from './ScreenFace'
import type { ScreenFrames } from './useAgentScreen'

export type ScreenSide = 'left' | 'right'
type Place = { side: ScreenSide; width: number }

const DEFAULT_WIDTH = 200
const MIN_WIDTH = 160
const MAX_WIDTH = 360
const TRACK_INSET = 12
const HANDLE = 36
const LANDING = { stiffness: 500, damping: 38 } as const

const placeFile = () => new File(Paths.document, 'chat-screen-place.json')

function loadPlace(): Place {
    try {
        const file = placeFile()
        const stored: unknown = file.exists ? JSON.parse(file.textSync()) : null
        const side = (stored as Partial<Place> | null)?.side === 'left' ? 'left' : 'right'
        const width = Number((stored as Partial<Place> | null)?.width)
        return { side, width: width ? Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width)) : DEFAULT_WIDTH }
    } catch {
        return { side: 'right', width: DEFAULT_WIDTH }
    }
}

function rememberPlace(side: ScreenSide, width: number) {
    try {
        placeFile().write(JSON.stringify({ side, width: Math.round(width) }))
    } catch {}
}

// Opacity and scale only: the thumbnail holds no glass, which goes blank under a fade.
const ENTER = new Keyframe({ 0: { opacity: 0, transform: [{ scale: 0.9 }] }, 100: { opacity: 1, transform: [{ scale: 1 }] } }).duration(280)
const EXIT = new Keyframe({ 0: { opacity: 1, transform: [{ scale: 1 }] }, 100: { opacity: 0, transform: [{ scale: 0.9 }] } }).duration(220)

// The latest copy of the screen the thread's block is showing, without a socket of its own.
export function ScreenMirror({ frames }: { frames: ScreenFrames }) {
    const frame = useSyncExternalStore(frames.subscribe, frames.current)
    if (!frame) return <ScreenFace status="loading" />
    return <Image source={{ uri: frame }} style={{ flex: 1 }} contentFit="cover" transition={0} cachePolicy="none" />
}

type FloatingScreenProps = {
    // Where the edge it slides along sits, under the chat's header.
    top: number
    label: string
    onTakeControl: () => void
    children: ReactNode
}

// The web's `FloatingScreen`: the screen the thread scrolled away from, kept at the top of the chat. It
// slides along that edge only: let go, it lands on the nearer side and stays there. Its inner bottom
// corner resizes it, a handle always drawn since a phone has no hover. A tap takes control.
export function FloatingScreen({ top, label, onTakeControl, children }: FloatingScreenProps) {
    const theme = useTheme()
    const t = useTranslations('mobileChat.screen')
    const [initial] = useState(loadPlace)
    const [side, setSide] = useState<ScreenSide>(initial.side)
    const track = useSharedValue(0)
    const width = useSharedValue(initial.width)
    const x = useSharedValue(-1)
    const sideValue = useSharedValue<ScreenSide>(initial.side)
    const start = useSharedValue({ x: 0, width: 0 })

    const onTrackLayout = ({ nativeEvent }: LayoutChangeEvent) => {
        const room = nativeEvent.layout.width
        track.value = room
        width.value = Math.min(width.value, room)
        x.value = sideValue.value === 'left' ? 0 : Math.max(0, room - width.value)
    }

    const land = (next: ScreenSide) => {
        setSide(next)
        rememberPlace(next, width.value)
    }

    const resize = Gesture.Pan()
        .minDistance(2)
        .onBegin(() => {
            start.value = { x: x.value, width: width.value }
        })
        .onUpdate(event => {
            const grown = sideValue.value === 'right' ? start.value.width - event.translationX : start.value.width + event.translationX
            width.value = Math.min(MAX_WIDTH, track.value, Math.max(MIN_WIDTH, grown))
            x.value = sideValue.value === 'left' ? 0 : Math.max(0, track.value - width.value)
        })
        .onEnd(() => {
            scheduleOnRN(land, sideValue.value)
        })

    const drag = Gesture.Pan()
        .minDistance(4)
        .requireExternalGestureToFail(resize)
        .onBegin(() => {
            start.value = { x: x.value, width: width.value }
        })
        .onUpdate(event => {
            x.value = Math.min(Math.max(0, start.value.x + event.translationX), Math.max(0, track.value - width.value))
        })
        .onEnd(() => {
            const next: ScreenSide = x.value + width.value / 2 < track.value / 2 ? 'left' : 'right'
            sideValue.value = next
            x.value = withSpring(next === 'left' ? 0 : Math.max(0, track.value - width.value), LANDING)
            scheduleOnRN(land, next)
        })
    const tap = Gesture.Tap()
        .requireExternalGestureToFail(resize)
        .onEnd((_, success) => {
            if (success) scheduleOnRN(onTakeControl)
        })

    const place = useAnimatedStyle(() => ({ width: width.value, opacity: x.value < 0 ? 0 : 1, transform: [{ translateX: Math.max(0, x.value) }] }))
    const handleOnRight = side === 'left'

    return (
        <View pointerEvents="box-none" onLayout={onTrackLayout} style={{ position: 'absolute', top, left: TRACK_INSET, right: TRACK_INSET, height: (MAX_WIDTH * 9) / 16, zIndex: 40 }}>
            <GestureDetector gesture={Gesture.Exclusive(drag, tap)}>
                <Animated.View accessible accessibilityRole="button" accessibilityLabel={label} style={[{ position: 'absolute', top: 0, left: 0, borderRadius: radius.md, boxShadow: '0 10px 24px rgba(0,0,0,0.22)' }, place]}>
                    <Animated.View entering={ENTER} exiting={EXIT} style={{ aspectRatio: 16 / 9, borderRadius: radius.md, borderCurve: 'continuous', overflow: 'hidden', borderWidth: 1, borderColor: theme.border, backgroundColor: theme.card, transformOrigin: side === 'left' ? 'top left' : 'top right' }}>
                        {children}
                        <GestureDetector gesture={resize}>
                            <View accessibilityLabel={t('resize')} style={{ position: 'absolute', bottom: 0, width: HANDLE, height: HANDLE, padding: 6, justifyContent: 'flex-end', alignItems: handleOnRight ? 'flex-end' : 'flex-start', ...(handleOnRight ? { right: 0 } : { left: 0 }) }}>
                                <View style={{ width: 10, height: 10, borderBottomWidth: 2, borderColor: 'rgba(255,255,255,0.9)', ...(handleOnRight ? { borderRightWidth: 2, borderBottomRightRadius: 3 } : { borderLeftWidth: 2, borderBottomLeftRadius: 3 }), shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 2, shadowOffset: { width: 0, height: 0 } }} />
                            </View>
                        </GestureDetector>
                    </Animated.View>
                </Animated.View>
            </GestureDetector>
        </View>
    )
}
