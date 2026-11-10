import { useEffect } from 'react'
import { View } from 'react-native'
import Animated, { Easing, FadeIn, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated'
import { useTranslations } from 'use-intl'

import { AppText } from '@/components/ui/AppText'
import { CoworkerAvatar } from '@/components/ui/CoworkerAvatar'
import type { Coworker, RunPhase } from '@/mocks/data'
import { spacing } from '@/theme/tokens'

// Under the last message while a coworker runs: its buddy at work and the phase.
export function RunStatus({ coworker, phase }: { coworker: Pick<Coworker, 'id' | 'kind' | 'name'>; phase: RunPhase }) {
    const t = useTranslations('mobileChat.runPhase')
    const pulse = useSharedValue(0.4)

    useEffect(() => {
        pulse.value = withRepeat(withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) }), -1, true)
    }, [pulse])
    const fade = useAnimatedStyle(() => ({ opacity: pulse.value }))

    return (
        <View accessibilityLiveRegion="polite" accessibilityLabel={t('label', { name: coworker.name, phase: t(phase) })} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 32 }}>
            <CoworkerAvatar coworker={{ id: coworker.id, kind: coworker.kind, status: 'working' }} size={24} facing="right" />
            <Animated.View key={phase} entering={FadeIn.duration(200)}>
                <Animated.View style={fade}>
                    <AppText variant="body" tone="muted">
                        {t(phase)}
                    </AppText>
                </Animated.View>
            </Animated.View>
        </View>
    )
}
