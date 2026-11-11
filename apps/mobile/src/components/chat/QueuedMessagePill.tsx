import { queuedPreview } from '@rerun/contracts'
import { Pressable, StyleSheet, View } from 'react-native'
import { useTranslations } from 'use-intl'

import { AppText } from '@/components/ui/AppText'
import { useGlassStyle } from '@/components/ui/GlassButton'
import { GlassSurface } from '@/components/ui/GlassSurface'
import { Icon } from '@/components/ui/Icon'
import { useTheme } from '@/theme/theme'
import { brand, radius, spacing, withAlpha } from '@/theme/tokens'

import { GLASS_SHADOW, GLASS_TINT_ALPHA } from './glass'

// Borderless: the strip is glass already, a glass button on it would be glass on glass.
function StripButton({ symbol, label, disabled, onPress }: { symbol: 'arrow-up' | 'x'; label: string; disabled: boolean; onPress: () => void }) {
    const theme = useTheme()
    return (
        <Pressable
            onPress={onPress}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ disabled }}
            hitSlop={6}
            style={({ pressed }) => ({ width: 30, height: 30, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.4 : pressed ? 0.5 : 1 })}
        >
            <Icon name={symbol} size={15} bold color={theme.mutedForeground} />
        </Pressable>
    )
}

/**
 * The web's `QueuedMessagePill`: the message waiting behind the run in flight, on a strip over the
 * composer. It leaves on its own once the run ends; « Send now » stops the run first, ✕ drops it.
 */
export function QueuedMessagePill({ text, busy, pending, onSendNow, onDiscard }: { text: string; busy: boolean; pending: boolean; onSendNow: () => void; onDiscard: () => void }) {
    const theme = useTheme()
    const glass = useGlassStyle()
    const t = useTranslations('mobileChat.queued')
    const preview = queuedPreview(text)
    const accent = theme.scheme === 'dark' ? brand.soft : brand.base
    return (
        <GlassSurface key={theme.scheme} colorScheme={theme.scheme} glassEffectStyle={glass} tintColor={withAlpha(theme.card, GLASS_TINT_ALPHA)} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingLeft: spacing.md, paddingRight: spacing.xs, paddingVertical: 4, borderRadius: radius.lg, borderCurve: 'continuous', borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border, boxShadow: GLASS_SHADOW[theme.scheme] }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 7, paddingVertical: 1, borderRadius: radius.pill, borderWidth: 1, borderColor: withAlpha(accent, 0.3), backgroundColor: withAlpha(accent, 0.1) }}>
                <Icon name="clock" size={10} bold color={accent} />
                <AppText style={{ fontSize: 11, lineHeight: 15, color: accent }}>{t('badge')}</AppText>
            </View>
            <AppText variant="footnote" tone="muted" numberOfLines={1} style={{ flex: 1 }}>
                {preview.text || t('attachmentsOnly')}
            </AppText>
            {preview.attachments.length > 0 && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                    <Icon name="paperclip" size={11} color={theme.mutedForeground} />
                    <AppText variant="caption" tone="muted">
                        {preview.attachments.length}
                    </AppText>
                </View>
            )}
            <StripButton symbol="arrow-up" label={busy ? t('sendNowStops') : t('sendNow')} disabled={pending} onPress={onSendNow} />
            <StripButton symbol="x" label={t('remove')} disabled={pending} onPress={onDiscard} />
        </GlassSurface>
    )
}
