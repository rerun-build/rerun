import { Pressable, View } from 'react-native'
import { useTranslations } from 'use-intl'

import { HitlAction, HitlIcon } from '@/components/chat/hitl/HitlCard'
import { AppText } from '@/components/ui/AppText'
import { Icon } from '@/components/ui/Icon'
import { useTheme } from '@/theme/theme'
import { spacing } from '@/theme/tokens'

import type { TakeoverRequestState } from './useTakeoverRequest'

// The web's `TakeoverAsk`: what the run asks of the person while it waits on its screen, under the
// screen it is about.
export function TakeoverAsk({ takeover }: { takeover: TakeoverRequestState }) {
    const theme = useTheme()
    const t = useTranslations('mobileChat.takeover')
    const { locked, opened, site } = takeover
    return (
        <View style={{ gap: spacing.md, padding: spacing.md }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm + 2 }}>
                <HitlIcon symbol="monitor" />
                <View style={{ flex: 1, gap: 2 }}>
                    <AppText variant="callout" medium>
                        {takeover.reason}
                    </AppText>
                    <AppText variant="footnote" tone="muted">
                        {opened ? t('opened') : site ? t('opensSite', { site }) : t('opensBrowser')}
                    </AppText>
                </View>
                <Pressable onPress={takeover.onSkip} disabled={locked} accessibilityRole="button" accessibilityLabel={t('skipTakeover')} hitSlop={12} style={({ pressed }) => ({ paddingTop: 4, opacity: locked ? 0.4 : pressed ? 0.5 : 1 })}>
                    <Icon name="x" size={13} bold color={theme.mutedForeground} />
                </Pressable>
            </View>
            <AppText variant="caption" style={{ color: theme.mutedForeground, opacity: 0.7 }}>
                {t('privacy')}
            </AppText>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: spacing.sm }}>
                {opened ? (
                    <>
                        <HitlAction label={t('openAgain')} onPress={takeover.onOpen} disabled={locked} />
                        <HitlAction label={takeover.finishing ? t('closing') : t('done')} primary onPress={takeover.onDone} disabled={locked} />
                    </>
                ) : (
                    <>
                        <HitlAction label={t('skip')} onPress={takeover.onSkip} disabled={locked} />
                        <HitlAction label={t('openBrowser')} primary onPress={takeover.onOpen} disabled={locked} />
                    </>
                )}
            </View>
        </View>
    )
}
