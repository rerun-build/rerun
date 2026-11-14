import type { ReactNode } from 'react'
import { Pressable } from 'react-native'
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated'

import { AppText } from '@/components/ui/AppText'
import * as Haptics from '@/lib/haptics'
import { useMessageTimes } from '@/lib/time'
import { MOTION } from '@/theme/motion'
import { spacing } from '@/theme/tokens'

export type MessageStamp = { createdAt: string; shown: boolean; onToggle: () => void }

const ignoreLongPress = () => {}

export function MessageTimeReveal({ stamp, side, children }: { stamp?: MessageStamp; side: 'left' | 'right'; children: ReactNode }) {
    const times = useMessageTimes()
    if (!stamp) return children
    return (
        <Pressable
            onPress={() => {
                Haptics.selectionAsync()
                stamp.onToggle()
            }}
            onLongPress={ignoreLongPress}
            accessible={false}
            style={{ alignItems: side === 'right' ? 'flex-end' : 'stretch' }}
        >
            {children}
            {stamp.shown && (
                <Animated.View entering={FadeIn.duration(MOTION.fast)} exiting={FadeOut.duration(MOTION.fast)}>
                    <AppText variant="caption" tone="muted" style={{ marginTop: spacing.xs, textAlign: side === 'right' ? 'right' : 'left' }}>
                        {times.stamp(stamp.createdAt)}
                    </AppText>
                </Animated.View>
            )}
        </Pressable>
    )
}
