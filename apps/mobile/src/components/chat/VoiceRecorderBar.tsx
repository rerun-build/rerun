import { useEffect, useState } from 'react'
import { View } from 'react-native'
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated'
import { useTranslations } from 'use-intl'

import { AppText } from '@/components/ui/AppText'
import { useTheme } from '@/theme/theme'
import { fonts, spacing } from '@/theme/tokens'

import type { VoiceLiveState, VoiceMessageError, VoiceMessageStatus } from './useVoiceMessage'
import { formatVoiceDuration } from './voice-duration'
import { LiveWaveform } from './VoiceWaveform'

const REFRESH_MS = 50
const DOT = 6

function RecordingDot() {
    const theme = useTheme()
    const pulse = useSharedValue(1)
    useEffect(() => {
        pulse.value = withRepeat(withTiming(0.35, { duration: 1000, easing: Easing.inOut(Easing.quad) }), -1, true)
    }, [pulse])
    const fade = useAnimatedStyle(() => ({ opacity: pulse.value }))
    return <Animated.View style={[{ width: DOT, height: DOT, borderRadius: DOT / 2, backgroundColor: theme.destructive }, fade]} />
}

type VoiceRecorderBarProps = {
    status: Exclude<VoiceMessageStatus, 'idle'>
    error: VoiceMessageError | null
    getLiveState: () => VoiceLiveState
}

// Takes the text field's place while a voice message is recorded or sent. The timer is polled here
// so the composer around it does not re-render twenty times a second.
export function VoiceRecorderBar({ status, error, getLiveState }: VoiceRecorderBarProps) {
    const theme = useTheme()
    const t = useTranslations('mobileChat.voice')
    const [durationMs, setDurationMs] = useState(0)

    useEffect(() => {
        if (status !== 'recording') return
        const timer = setInterval(() => setDurationMs(getLiveState().durationMs), REFRESH_MS)
        return () => clearInterval(timer)
    }, [status, getLiveState])

    if (status === 'failed') {
        return (
            <View style={{ flex: 1, minHeight: 48, justifyContent: 'center' }}>
                <AppText variant="footnote" numberOfLines={2} style={{ color: theme.destructive }}>
                    {t(error ?? 'sendFailed')}
                </AppText>
            </View>
        )
    }

    if (status === 'starting') {
        return (
            <View style={{ flex: 1, minHeight: 48, justifyContent: 'center' }}>
                <AppText variant="footnote" tone="muted" numberOfLines={1}>
                    {t('waitingForMicrophone')}
                </AppText>
            </View>
        )
    }

    return (
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <LiveWaveform processing={status === 'processing'} getLevel={() => getLiveState().level} color={theme.foreground} />
            {status === 'recording' && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <RecordingDot />
                    <AppText variant="caption" style={{ fontFamily: fonts.mono, color: theme.mutedForeground, fontVariant: ['tabular-nums'] }}>
                        {formatVoiceDuration(durationMs)}
                    </AppText>
                </View>
            )}
        </View>
    )
}
