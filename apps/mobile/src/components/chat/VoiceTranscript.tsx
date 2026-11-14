import { transcriptWords } from '@rerun/contracts'
import { useMemo } from 'react'
import { Text } from 'react-native'
import Animated, { FadeInDown, FadeOut, LayoutAnimationConfig } from 'react-native-reanimated'

import { AppText } from '@/components/ui/AppText'
import { EASE_OUT, MOTION } from '@/theme/motion'
import { useTheme } from '@/theme/theme'
import { brand, fonts, spacing, withAlpha } from '@/theme/tokens'

const MAX_WIDTH = 320

type VoiceTranscriptProps = {
    transcript: string
    heardUpTo: number | null
}

export function VoiceTranscript({ transcript, heardUpTo }: VoiceTranscriptProps) {
    const theme = useTheme()
    const words = useMemo(() => transcriptWords(transcript), [transcript])
    const colorOf = (start: number) => (heardUpTo === null ? theme.mutedForeground : start <= heardUpTo ? withAlpha(theme.foreground, 0.85) : withAlpha(theme.mutedForeground, 0.45))

    return (
        <LayoutAnimationConfig skipEntering={false}>
            <Animated.View entering={FadeInDown.duration(MOTION.base * 2).easing(EASE_OUT)} exiting={FadeOut.duration(MOTION.fast)} style={{ maxWidth: MAX_WIDTH, marginTop: spacing.xs, borderRightWidth: 2, borderRightColor: withAlpha(brand.base, theme.scheme === 'dark' ? 0.7 : 0.35), paddingRight: spacing.md }}>
                <AppText variant="footnote" tone="muted" style={{ fontFamily: fonts.italic, textAlign: 'right', lineHeight: 20 }}>
                    {words.map((word, index) => (
                        <Text key={index} style={{ color: colorOf(word.start) }}>
                            {word.text}
                        </Text>
                    ))}
                </AppText>
            </Animated.View>
        </LayoutAnimationConfig>
    )
}
