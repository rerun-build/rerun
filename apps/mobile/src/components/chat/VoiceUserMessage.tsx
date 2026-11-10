import type { VoiceMessage } from '@rerun/contracts'
import * as Clipboard from 'expo-clipboard'
import * as Haptics from 'expo-haptics'
import { useState } from 'react'
import Animated from 'react-native-reanimated'
import { useTranslations } from 'use-intl'

import type { FileOwner } from '@/api/files'
import type { ViewerItem } from '@/components/viewer/viewer-store'
import { layoutTransition } from '@/theme/motion'
import { spacing } from '@/theme/tokens'

import type { MessageStamp } from './MessageTimeReveal'
import { Action, UserBubble } from './Messages'
import { useVoicePlayback } from './useVoicePlayback'
import { VoiceMessageBubble } from './VoiceMessageBubble'
import { VoiceTranscript } from './VoiceTranscript'

type VoiceUserMessageProps = {
    voice: VoiceMessage
    // Where the recording sits; none in a mock thread, which has nothing to play.
    owner: FileOwner | null
    media?: ViewerItem[]
    stamp?: MessageStamp
    defaultTranscriptOpen?: boolean
}

/** A voice message the person sent: the player in the bubble, and under it Transcript and Copy, always shown on a phone. */
export function VoiceUserMessage({ voice, owner, media, stamp, defaultTranscriptOpen = false }: VoiceUserMessageProps) {
    const playback = useVoicePlayback(voice, owner)
    const [open, setOpen] = useState(defaultTranscriptOpen)
    const t = useTranslations('mobileChat.voice')
    const started = playback.playing || playback.elapsedMs > 0
    const transcript = voice.transcript

    const footer = transcript ? (
        <Animated.View layout={layoutTransition} style={{ alignItems: 'flex-end' }}>
            {open && <VoiceTranscript transcript={transcript} heardUpTo={started ? playback.progress : null} />}
            <Animated.View layout={layoutTransition} style={{ flexDirection: 'row', marginRight: -spacing.sm }}>
                <Action
                    symbol={open ? 'captions.bubble.fill' : 'captions.bubble'}
                    label={open ? t('hideTranscript') : t('transcript')}
                    selected={open}
                    onPress={() => {
                        Haptics.selectionAsync()
                        setOpen(value => !value)
                    }}
                />
                <Action
                    symbol="doc.on.doc"
                    label={t('copyTranscript')}
                    onPress={() => {
                        Clipboard.setStringAsync(transcript)
                        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
                    }}
                />
            </Animated.View>
        </Animated.View>
    ) : undefined

    return (
        <UserBubble text="" media={media} owner={owner} stamp={stamp} footer={footer}>
            <VoiceMessageBubble voice={voice} playback={playback} />
        </UserBubble>
    )
}
