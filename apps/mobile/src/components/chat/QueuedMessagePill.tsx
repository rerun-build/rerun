import { Button, Host, Image } from '@expo/ui/swift-ui'
import { accessibilityLabel, buttonStyle, disabled as disabledModifier, font, frame } from '@expo/ui/swift-ui/modifiers'
import { queuedPreview } from '@rerun/contracts'
import { GlassView } from 'expo-glass-effect'
import { SymbolView } from 'expo-symbols'
import { StyleSheet, View } from 'react-native'
import { useTranslations } from 'use-intl'

import { AppText } from '@/components/ui/AppText'
import { useGlassStyle } from '@/components/ui/GlassButton'
import { useTheme } from '@/theme/theme'
import { brand, radius, spacing, withAlpha } from '@/theme/tokens'

import { GLASS_SHADOW, GLASS_TINT_ALPHA } from './glass'

// Borderless: the strip is glass already, a glass button on it would be glass on glass.
function StripButton({ symbol, label, disabled, onPress }: { symbol: 'arrow.up' | 'xmark'; label: string; disabled: boolean; onPress: () => void }) {
    const theme = useTheme()
    return (
        <Host matchContents colorScheme={theme.scheme}>
            <Button onPress={onPress} modifiers={[buttonStyle('borderless'), disabledModifier(disabled), accessibilityLabel(label)]}>
                <Image systemName={symbol} color={theme.mutedForeground} modifiers={[font({ size: 13, weight: 'semibold' }), frame({ width: 30, height: 30 })]} />
            </Button>
        </Host>
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
        <GlassView key={theme.scheme} colorScheme={theme.scheme} glassEffectStyle={glass} tintColor={withAlpha(theme.card, GLASS_TINT_ALPHA)} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingLeft: spacing.md, paddingRight: spacing.xs, paddingVertical: 4, borderRadius: radius.lg, borderCurve: 'continuous', borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border, boxShadow: GLASS_SHADOW[theme.scheme] }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 7, paddingVertical: 1, borderRadius: radius.pill, borderWidth: 1, borderColor: withAlpha(accent, 0.3), backgroundColor: withAlpha(accent, 0.1) }}>
                <SymbolView name="clock" size={10} weight="semibold" tintColor={accent} />
                <AppText style={{ fontSize: 11, lineHeight: 15, color: accent }}>{t('badge')}</AppText>
            </View>
            <AppText variant="footnote" tone="muted" numberOfLines={1} style={{ flex: 1 }}>
                {preview.text || t('attachmentsOnly')}
            </AppText>
            {preview.attachments.length > 0 && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                    <SymbolView name="paperclip" size={11} tintColor={theme.mutedForeground} />
                    <AppText variant="caption" tone="muted">
                        {preview.attachments.length}
                    </AppText>
                </View>
            )}
            <StripButton symbol="arrow.up" label={busy ? t('sendNowStops') : t('sendNow')} disabled={pending} onPress={onSendNow} />
            <StripButton symbol="xmark" label={t('remove')} disabled={pending} onPress={onDiscard} />
        </GlassView>
    )
}
