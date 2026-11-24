import type { ResumeChat } from '@rerun/contracts'
import { Pressable } from 'react-native'
import Animated from 'react-native-reanimated'
import { useTranslations } from 'use-intl'

import { AppText } from '@/components/ui/AppText'
import { useGlassStyle } from '@/components/ui/GlassButton'
import { GlassSurface } from '@/components/ui/GlassSurface'
import { Icon } from '@/components/ui/Icon'
import { useTheme } from '@/theme/theme'
import { radius, spacing } from '@/theme/tokens'

import { RISE_IN, SINK_OUT } from './ScrollToEndButton'

const HEIGHT = 40

// The conversation left open on another device, offered over the composer rather than opened by itself.
export function ResumeChatPill({ resume, onContinue, onDismiss }: { resume: ResumeChat; onContinue: (sessionId: string) => void; onDismiss: () => void }) {
    const t = useTranslations('mobileChat.resume')
    const theme = useTheme()
    const glass = useGlassStyle()
    const title = resume.title ?? t('untitled')
    return (
        <Animated.View entering={RISE_IN} exiting={SINK_OUT} style={{ alignItems: 'center', paddingHorizontal: spacing.lg }} pointerEvents="box-none">
            <GlassSurface key={theme.scheme} colorScheme={theme.scheme} glassEffectStyle={glass} style={{ flexDirection: 'row', alignItems: 'center', height: HEIGHT, maxWidth: '100%', borderRadius: radius.pill }}>
                <Pressable onPress={() => onContinue(resume.sessionId)} accessibilityRole="button" style={({ pressed }) => ({ flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, height: HEIGHT, paddingLeft: spacing.md, opacity: pressed ? 0.5 : 1 })}>
                    <Icon name={resume.deviceKind === 'phone' ? 'smartphone' : 'monitor'} size={14} color={theme.mutedForeground} />
                    <AppText variant="callout" numberOfLines={1} style={{ flexShrink: 1 }}>
                        {t.rich('continue', {
                            title,
                            verb: chunks => (
                                <AppText variant="callout" tone="muted">
                                    {chunks}
                                </AppText>
                            ),
                            name: chunks => (
                                <AppText variant="callout" medium>
                                    {chunks}
                                </AppText>
                            ),
                        })}
                    </AppText>
                </Pressable>
                <Pressable onPress={onDismiss} accessibilityRole="button" accessibilityLabel={t('dismiss')} hitSlop={4} style={({ pressed }) => ({ width: HEIGHT, height: HEIGHT, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.5 : 1 })}>
                    <Icon name="x" size={14} bold color={theme.mutedForeground} />
                </Pressable>
            </GlassSurface>
        </Animated.View>
    )
}
