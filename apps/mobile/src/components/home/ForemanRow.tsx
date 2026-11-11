import { FOREMAN_AGENT_ID, FOREMAN_DISPLAY_NAME } from '@rerun/contracts'
import { Pressable, View } from 'react-native'
import { useTranslations } from 'use-intl'

import { AVATAR, HOME_GUTTER, PinSwipe, ROW_TITLE, type PinControl } from '@/components/home/CoworkerRow'
import type { ForemanLast } from '@/components/home/useForemanLast'
import { AppText } from '@/components/ui/AppText'
import { CoworkerAvatar } from '@/components/ui/CoworkerAvatar'
import { useTheme } from '@/theme/theme'
import { spacing } from '@/theme/tokens'

// The Foreman at the head of the list, drawn as a coworker's row: no time, its last conversation under its name.
export function ForemanRow({ last, selected = false, onPress, pin }: { last: ForemanLast; selected?: boolean; onPress: () => void; pin?: PinControl }) {
    const theme = useTheme()
    const t = useTranslations('mobileHome')
    const line = last.title || t('foreman.askAnything')
    const row = (
        <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={t('row.label', { name: FOREMAN_DISPLAY_NAME, line })} accessibilityHint={t('row.opensConversation')} accessibilityState={{ selected }} accessibilityActions={pin ? [{ name: 'togglePin', label: pin.pinned ? t('row.unpin') : t('row.pinToTop') }] : undefined} onAccessibilityAction={event => event.nativeEvent.actionName === 'togglePin' && pin?.onToggle()} style={selected ? { backgroundColor: theme.muted } : pin ? { backgroundColor: theme.background } : undefined}>
            {({ pressed }) => (
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.lg, paddingVertical: spacing.lg, paddingHorizontal: HOME_GUTTER, opacity: pressed ? 0.6 : 1 }}>
                    <CoworkerAvatar coworker={{ id: FOREMAN_AGENT_ID, kind: 'foreman', status: last.running ? 'working' : 'idle' }} size={AVATAR} facing="right" />
                    <View style={{ flex: 1, gap: 2 }}>
                        <AppText variant="headline" numberOfLines={1} maxFontSizeMultiplier={1.4} style={ROW_TITLE}>
                            {FOREMAN_DISPLAY_NAME}
                        </AppText>
                        <AppText variant="callout" tone="muted" numberOfLines={1} maxFontSizeMultiplier={1.4}>
                            {line}
                        </AppText>
                    </View>
                </View>
            )}
        </Pressable>
    )
    return pin ? <PinSwipe pin={pin}>{row}</PinSwipe> : row
}
