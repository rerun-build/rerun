import { PEAK_COUNT, type VoiceMessage } from '@rerun/contracts'
import { ActivityIndicator, Pressable, View } from 'react-native'
import { useTranslations } from 'use-intl'

import { AppText } from '@/components/ui/AppText'
import { Icon } from '@/components/ui/Icon'
import { fonts, spacing } from '@/theme/tokens'

import type { VoicePlayback } from './useVoicePlayback'
import { formatVoiceDuration } from './voice-duration'
import { VoiceWaveform } from './VoiceWaveform'

const BUTTON = 32
const WAVE_WIDTH = 128
const RESTING_PEAKS = Array.from({ length: PEAK_COUNT }, () => 0.25)

/** The player drawn inside the user bubble: play, the waveform to seek on, the timer. */
export function VoiceMessageBubble({ voice, playback }: { voice: VoiceMessage; playback: VoicePlayback }) {
    const { readable, playable, loaded, loading, playing, elapsedMs, progress, toggle, seekAt } = playback
    const peaks = voice.peaks.length > 0 ? voice.peaks : RESTING_PEAKS
    const t = useTranslations('mobileChat.voice')

    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2 }}>
            <Pressable onPress={toggle} disabled={!playable || loading} accessibilityRole="button" accessibilityLabel={playing ? t('pause') : t('play')} accessibilityState={{ disabled: !playable, busy: loading }} hitSlop={6} style={({ pressed }) => ({ width: BUTTON, height: BUTTON, borderRadius: BUTTON / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: `rgba(255,255,255,${pressed ? 0.25 : 0.15})`, opacity: readable ? 1 : 0.5 })}>
                {loading ? <ActivityIndicator size="small" color="#ffffff" /> : <Icon name={playing ? 'pause-fill' : 'play-fill'} size={13} color="#ffffff" />}
            </Pressable>
            <Pressable onPress={event => seekAt(event.nativeEvent.locationX / WAVE_WIDTH)} disabled={!loaded} accessibilityLabel={t('seek')}>
                <VoiceWaveform peaks={peaks} progress={progress} color="#ffffff" width={WAVE_WIDTH} />
            </Pressable>
            <AppText variant="caption" style={{ fontFamily: fonts.mono, color: 'rgba(255,255,255,0.7)', fontVariant: ['tabular-nums'] }}>
                {formatVoiceDuration(playing || elapsedMs > 0 ? elapsedMs : voice.durationMs)}
            </AppText>
        </View>
    )
}
