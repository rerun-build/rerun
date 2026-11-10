import { SymbolView } from 'expo-symbols'
import { useState } from 'react'
import { Pressable, View } from 'react-native'
import { useTranslations } from 'use-intl'

import { AppText } from '@/components/ui/AppText'
import { hostOf, openExternalUrl } from '@/lib/url'
import { useTheme } from '@/theme/theme'
import { spacing } from '@/theme/tokens'

export type Source = { url: string; title?: string }

// The pages a message drew on, folded under it.
export function Sources({ sources }: { sources: Source[] }) {
    const t = useTranslations('mobileCards.sources')
    const theme = useTheme()
    const [open, setOpen] = useState(false)
    const label = t('count', { count: sources.length })
    return (
        <View style={{ gap: spacing.xs }}>
            <Pressable onPress={() => setOpen(current => !current)} accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={label} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <SymbolView name="link" size={13} weight="medium" tintColor={theme.mutedForeground} />
                <AppText variant="footnote" tone="muted">
                    {label}
                </AppText>
                <SymbolView name={open ? 'chevron.up' : 'chevron.down'} size={10} weight="semibold" tintColor={theme.mutedForeground} />
            </Pressable>
            {open &&
                sources.map(source => (
                    <Pressable key={source.url} onPress={() => openExternalUrl(source.url)} accessibilityRole="link" accessibilityLabel={source.title || hostOf(source.url) || source.url} style={({ pressed }) => ({ paddingLeft: spacing.lg + 2, opacity: pressed ? 0.5 : 1 })}>
                        <AppText variant="footnote" numberOfLines={1}>
                            {source.title || hostOf(source.url)}
                        </AppText>
                        <AppText variant="caption" tone="muted" numberOfLines={1}>
                            {hostOf(source.url)}
                        </AppText>
                    </Pressable>
                ))}
        </View>
    )
}
