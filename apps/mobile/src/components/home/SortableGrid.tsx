import * as Haptics from 'expo-haptics'
import { useEffect, useState, type ReactNode } from 'react'
import { View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { cancelAnimation, runOnJS, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming, type SharedValue } from 'react-native-reanimated'
import { useTranslations } from 'use-intl'

import { hashUnit } from '@/components/buddy/look'

type Item = { id: string }
type Size = { width: number; height: number }

const WIGGLE_DEGREES = 2

function placeOf(index: number, columns: number, cell: Size) {
    'worklet'
    return { x: (index % columns) * cell.width, y: Math.floor(index / columns) * cell.height }
}

function Cell({ id, count, columns, cell, order, onDrop, children }: { id: string; count: number; columns: number; cell: Size; order: SharedValue<string[]>; onDrop: (ids: string[]) => void; children: ReactNode }) {
    const t = useTranslations('mobileHome')
    const dragging = useSharedValue(false)
    const x = useSharedValue(0)
    const y = useSharedValue(0)
    const start = useSharedValue({ x: 0, y: 0 })
    const wiggle = useSharedValue(0)

    // Each cell shakes on its own beat, as the home screen does in its edit mode.
    useEffect(() => {
        const beat = 110 + hashUnit(id, 3) * 40
        wiggle.value = withRepeat(withSequence(withTiming(WIGGLE_DEGREES, { duration: beat }), withTiming(-WIGGLE_DEGREES, { duration: beat })), -1, true)
        return () => cancelAnimation(wiggle)
    }, [id, wiggle])

    const pan = Gesture.Pan()
        .minDistance(0)
        .onStart(() => {
            dragging.value = true
            start.value = placeOf(order.value.indexOf(id), columns, cell)
            x.value = start.value.x
            y.value = start.value.y
            runOnJS(Haptics.impactAsync)(Haptics.ImpactFeedbackStyle.Medium)
        })
        .onUpdate(event => {
            const rows = Math.ceil(count / columns)
            x.value = Math.max(0, Math.min((columns - 1) * cell.width, start.value.x + event.translationX))
            y.value = Math.max(0, Math.min((rows - 1) * cell.height, start.value.y + event.translationY))
            const target = Math.min(count - 1, Math.round(y.value / cell.height) * columns + Math.round(x.value / cell.width))
            const current = order.value.indexOf(id)
            if (target === current) return
            const next = [...order.value]
            next.splice(current, 1)
            next.splice(target, 0, id)
            order.set(next)
            runOnJS(Haptics.selectionAsync)()
        })
        .onFinalize(() => {
            if (!dragging.value) return
            dragging.value = false
            runOnJS(onDrop)(order.value)
        })

    const style = useAnimatedStyle(() => {
        const place = placeOf(order.value.indexOf(id), columns, cell)
        return {
            left: dragging.value ? x.value : withTiming(place.x, { duration: 160 }),
            top: dragging.value ? y.value : withTiming(place.y, { duration: 160 }),
            zIndex: dragging.value ? 2 : 1,
            transform: [{ scale: withTiming(dragging.value ? 1.08 : 1) }, { rotate: `${dragging.value ? 0 : wiggle.value}deg` }],
        }
    })

    return (
        <GestureDetector gesture={pan}>
            <Animated.View accessible accessibilityRole="adjustable" accessibilityHint={t('pinned.dragToReorder')} style={[{ position: 'absolute', width: cell.width, height: cell.height }, style]}>
                <View pointerEvents="none">{children}</View>
            </Animated.View>
        </GestureDetector>
    )
}

/**
 * Cells dragged into a new order on a grid, as icons on the iOS home screen in edit mode. Every cell
 * has the same size, its height measured on the first one; the order is handed back once a cell is dropped.
 */
export function SortableGrid<T extends Item>({ items, columns, cellWidth, renderCell, onReorder }: { items: T[]; columns: number; cellWidth: number; renderCell: (item: T) => ReactNode; onReorder: (ids: string[]) => void }) {
    const [cellHeight, setCellHeight] = useState(0)
    const order = useSharedValue(items.map(item => item.id))

    useEffect(() => {
        order.value = items.map(item => item.id)
    }, [items, order])

    if (cellHeight === 0) {
        return (
            <View onLayout={event => setCellHeight(event.nativeEvent.layout.height)} style={{ opacity: 0, width: cellWidth }}>
                {items[0] && renderCell(items[0])}
            </View>
        )
    }
    const cell = { width: cellWidth, height: cellHeight }
    return (
        <View style={{ height: cellHeight * Math.ceil(items.length / columns), width: cellWidth * columns }}>
            {items.map(item => (
                <Cell key={item.id} id={item.id} count={items.length} columns={columns} cell={cell} order={order} onDrop={onReorder}>
                    {renderCell(item)}
                </Cell>
            ))}
        </View>
    )
}
