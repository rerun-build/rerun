import type { HitlKind } from '@rerun/contracts'
import { GlassView } from 'expo-glass-effect'
import { Pressable, View } from 'react-native'
import { useTranslations } from 'use-intl'

import { AppText } from '@/components/ui/AppText'
import { useGlassStyle } from '@/components/ui/GlassButton'
import { Icon } from '@/components/ui/Icon'
import { useTheme } from '@/theme/theme'
import { brand, radius, spacing, withAlpha } from '@/theme/tokens'

import { summarizePendingHitl } from './summary'

const DECISION = '#f97316'

// The web's scroll-to-bottom arrow grown into what the coworker is waiting for, down the thread.
export function PendingHitlPill({ kind, input, onJump }: { kind: HitlKind; input: Record<string, unknown>; onJump: () => void }) {
    const t = useTranslations('mobileHitl')
    const theme = useTheme()
    const glass = useGlassStyle()
    const { symbol, label } = summarizePendingHitl(kind, input, t)
    const accent = kind === 'question' ? brand.base : kind === 'approval' ? DECISION : theme.foreground
    return (
        <Pressable onPress={onJump} accessibilityRole="button" accessibilityLabel={t('pending.jumpTo', { label })} style={{ maxWidth: '100%' }}>
            <GlassView isInteractive colorScheme={theme.scheme} glassEffectStyle={glass} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, height: 40, paddingLeft: 6, paddingRight: spacing.md, borderRadius: radius.pill }}>
                <View style={{ width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: withAlpha(accent, 0.12) }}>
                    <Icon name={symbol} size={13} bold color={accent} />
                </View>
                <AppText variant="callout" medium numberOfLines={1} style={{ flexShrink: 1 }}>
                    {label}
                </AppText>
                <Icon name="arrow-down" size={12} bold color={theme.mutedForeground} />
            </GlassView>
        </Pressable>
    )
}
