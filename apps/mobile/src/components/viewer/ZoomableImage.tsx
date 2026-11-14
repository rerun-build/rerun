import { Image } from 'expo-image'
import { useEffect } from 'react'
import { useWindowDimensions } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated'

const MAX_SCALE = 4
const DOUBLE_TAP_SCALE = 2.5
const DISMISS_DISTANCE = 120

type ZoomableImageProps = {
    uri: string
    headers?: Record<string, string>
    active: boolean
    onZoomChange: (zoomed: boolean) => void
    onDismiss: () => void
    onDrag: (progress: number) => void
}

export function ZoomableImage({ uri, headers, active, onZoomChange, onDismiss, onDrag }: ZoomableImageProps) {
    const { width, height } = useWindowDimensions()
    const scale = useSharedValue(1)
    const savedScale = useSharedValue(1)
    const x = useSharedValue(0)
    const y = useSharedValue(0)
    const savedX = useSharedValue(0)
    const savedY = useSharedValue(0)
    const dismissY = useSharedValue(0)

    useEffect(() => {
        if (active) return
        scale.value = 1
        savedScale.value = 1
        x.value = 0
        y.value = 0
        savedX.value = 0
        savedY.value = 0
    }, [active, scale, savedScale, x, y, savedX, savedY])

    const clampTranslation = (value: number, size: number, zoom: number) => {
        'worklet'
        const bound = Math.max(0, (size * zoom - size) / 2)
        return Math.min(bound, Math.max(-bound, value))
    }

    const settle = (zoom: number) => {
        'worklet'
        runOnJS(onZoomChange)(zoom > 1.01)
    }

    const pinch = Gesture.Pinch()
        .onUpdate(event => {
            scale.value = Math.min(MAX_SCALE, Math.max(1, savedScale.value * event.scale))
        })
        .onEnd(() => {
            savedScale.value = scale.value
            if (scale.value <= 1.01) {
                x.value = withTiming(0)
                y.value = withTiming(0)
                savedX.value = 0
                savedY.value = 0
            }
            settle(scale.value)
        })

    const pan = Gesture.Pan()
        .activeOffsetY([-12, 12])
        .failOffsetX([-24, 24])
        .onUpdate(event => {
            if (savedScale.value > 1.01) {
                x.value = clampTranslation(savedX.value + event.translationX, width, scale.value)
                y.value = clampTranslation(savedY.value + event.translationY, height, scale.value)
                return
            }
            dismissY.value = Math.max(0, event.translationY)
            runOnJS(onDrag)(Math.min(1, dismissY.value / (DISMISS_DISTANCE * 2)))
        })
        .onEnd(() => {
            if (savedScale.value > 1.01) {
                savedX.value = x.value
                savedY.value = y.value
                return
            }
            if (dismissY.value > DISMISS_DISTANCE) {
                runOnJS(onDismiss)()
                return
            }
            dismissY.value = withSpring(0)
            runOnJS(onDrag)(0)
        })

    const zoomedPan = Gesture.Pan()
        .manualActivation(true)
        .onTouchesMove((_, manager) => {
            if (savedScale.value > 1.01) manager.activate()
            else manager.fail()
        })
        .onUpdate(event => {
            x.value = clampTranslation(savedX.value + event.translationX, width, scale.value)
            y.value = clampTranslation(savedY.value + event.translationY, height, scale.value)
        })
        .onEnd(() => {
            savedX.value = x.value
            savedY.value = y.value
        })

    const doubleTap = Gesture.Tap()
        .numberOfTaps(2)
        .onEnd(event => {
            const zoomIn = savedScale.value <= 1.01
            const next = zoomIn ? DOUBLE_TAP_SCALE : 1
            const targetX = zoomIn ? clampTranslation((width / 2 - event.x) * (next - 1), width, next) : 0
            const targetY = zoomIn ? clampTranslation((height / 2 - event.y) * (next - 1), height, next) : 0
            scale.value = withTiming(next)
            x.value = withTiming(targetX)
            y.value = withTiming(targetY)
            savedScale.value = next
            savedX.value = targetX
            savedY.value = targetY
            settle(next)
        })

    const style = useAnimatedStyle(() => ({
        transform: [{ translateX: x.value }, { translateY: y.value + dismissY.value }, { scale: scale.value * (1 - Math.min(0.25, dismissY.value / 1600)) }],
    }))

    return (
        <GestureDetector gesture={Gesture.Simultaneous(pinch, Gesture.Exclusive(zoomedPan, pan), doubleTap)}>
            <Animated.View style={[{ width, height, alignItems: 'center', justifyContent: 'center' }, style]}>
                <Image source={{ uri, headers }} contentFit="contain" transition={150} style={{ width, height }} />
            </Animated.View>
        </GestureDetector>
    )
}
