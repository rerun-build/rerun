import { FOREMAN_AGENT_ID } from '@rerun/contracts'
import { Pressable, View } from 'react-native'
import { useTranslations } from 'use-intl'

import { HOME_GUTTER, ROW_TITLE } from '@/components/home/CoworkerRow'
import type { ForemanLast } from '@/components/home/useForemanLast'
import { AppText } from '@/components/ui/AppText'
import { CoworkerAvatar } from '@/components/ui/CoworkerAvatar'
import { useTheme } from '@/theme/theme'
import { spacing } from '@/theme/tokens'

const ORB = 52

// The Foreman on its own at the top of the Home, the way Grok sets its own entries above the
// conversations: a larger orb, no pin, no time, its last conversation under its name.
export function ForemanRow({ last, selected = false, onPress }: { last: ForemanLast; selected?: boolean; onPress: () => void }) {
    const theme = useTheme()
    const t = useTranslations('mobileHome')
    const line = last.title || t('foreman.askAnything')
    return (
        <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={t('row.label', { name: 'Rerun', line })} accessibilityHint={t('row.opensConversation')} accessibilityState={{ selected }} style={selected ? { backgroundColor: theme.muted } : undefined}>
            {({ pressed }) => (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.lg, paddingVertical: spacing.sm, paddingHorizontal: HOME_GUTTER, opacity: pressed ? 0.6 : 1 }}>
                    <CoworkerAvatar coworker={{ id: FOREMAN_AGENT_ID, kind: 'foreman', status: last.running ? 'working' : 'idle' }} size={ORB} facing="right" />
                    <View style={{ flex: 1, gap: 2 }}>
                        <AppText variant="headline" numberOfLines={1} maxFontSizeMultiplier={1.4} style={ROW_TITLE}>
                            Rerun
                        </AppText>
                        <AppText variant="callout" tone="muted" numberOfLines={1} maxFontSizeMultiplier={1.4}>
                            {line}
                        </AppText>
                    </View>
                </View>
            )}
        </Pressable>
    )
}
