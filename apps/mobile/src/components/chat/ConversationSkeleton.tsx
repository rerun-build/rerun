import type { DimensionValue } from 'react-native'
import { View } from 'react-native'
import Animated, { FadeOut } from 'react-native-reanimated'
import { useTranslations } from 'use-intl'

import { Skeleton } from '@/components/ui/Skeleton'
import { MOTION } from '@/theme/motion'
import { useTheme } from '@/theme/theme'
import { radius, spacing } from '@/theme/tokens'

import { BUBBLE_GAP, BUBBLE_PADDING_X, BUBBLE_PADDING_Y, BUBBLE_RADIUS } from './Messages'

const LINE = 24
const BAR = 12
const USER_BUBBLE_HEIGHT = LINE + (spacing.md - 2) * 2

type Turn = { role: 'user'; width: DimensionValue } | { role: 'assistant'; paragraphs: DimensionValue[][] }

const TURNS: Turn[] = [
    { role: 'user', width: '46%' },
    { role: 'assistant', paragraphs: [['100%', '96%', '58%']] },
    { role: 'user', width: '64%' },
    {
        role: 'assistant',
        paragraphs: [
            ['100%', '92%'],
            ['100%', '97%', '40%'],
        ],
    },
]

export function ConversationSkeleton() {
    const theme = useTheme()
    const t = useTranslations('mobileChat.pane')
    return (
        <Animated.View exiting={FadeOut.duration(MOTION.fast)} accessible accessibilityLabel={t('loading')} style={{ gap: spacing.xl }}>
            {TURNS.map((turn, index) =>
                turn.role === 'user' ? (
                    <Skeleton key={index} style={{ alignSelf: 'flex-end', width: turn.width, height: USER_BUBBLE_HEIGHT, borderRadius: radius.xl, borderBottomRightRadius: 6 }} />
                ) : (
                    <View key={index} style={{ gap: BUBBLE_GAP }}>
                        {turn.paragraphs.map((lines, paragraph) => (
                            <View key={paragraph} style={{ alignSelf: 'flex-start', width: '80%', paddingHorizontal: BUBBLE_PADDING_X, paddingVertical: BUBBLE_PADDING_Y, borderRadius: BUBBLE_RADIUS, borderCurve: 'continuous', backgroundColor: theme.muted }}>
                                <View style={{ gap: LINE - BAR, paddingVertical: (LINE - BAR) / 2 }}>
                                    {lines.map((width, line) => (
                                        <Skeleton key={line} style={{ width, height: BAR, backgroundColor: theme.background }} />
                                    ))}
                                </View>
                            </View>
                        ))}
                    </View>
                )
            )}
        </Animated.View>
    )
}
