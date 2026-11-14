import type { ReactNode } from 'react'
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native'
import { useTranslations } from 'use-intl'

import { AppText } from '@/components/ui/AppText'
import { BorderBeam } from '@/components/ui/BorderBeam'
import { Icon } from '@/components/ui/Icon'
import { useTheme } from '@/theme/theme'
import { mix, radius, spacing } from '@/theme/tokens'

import { TakeoverAsk } from './TakeoverAsk'
import type { TakeoverRequestState } from './useTakeoverRequest'

const OVERLAY = 'rgba(0,0,0,0.55)'

function ScreenPill({ symbol, label }: { symbol: 'globe' | 'mouse-pointer'; label: string }) {
    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: '100%', paddingHorizontal: 7, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: OVERLAY }}>
            <Icon name={symbol} size={11} color="#ffffff" />
            <AppText variant="caption" medium numberOfLines={1} style={{ color: '#ffffff', fontSize: 11, lineHeight: 14, flexShrink: 1 }}>
                {label}
            </AppText>
        </View>
    )
}

type ScreenCardProps = {
    live: boolean
    site: string | null
    screen: ReactNode
    takeover?: TakeoverRequestState
    onTakeControl: () => void
    onLayout?: (event: LayoutChangeEvent) => void
}

export function ScreenCard({ live, site, screen, takeover, onTakeControl, onLayout }: ScreenCardProps) {
    const theme = useTheme()
    const t = useTranslations('mobileChat.pane')
    const surface = takeover ? mix(theme.card, theme.muted, 0.3) : theme.card
    const label = takeover ? t('openBrowser') : t('takeControl')
    return (
        <View onLayout={onLayout} style={{ width: '95%', borderRadius: radius.lg, borderCurve: 'continuous', borderWidth: 1, borderColor: theme.border, backgroundColor: surface }}>
            {takeover && <BorderBeam tone="brand" radius={radius.lg} surface={surface} />}
            <View style={{ padding: takeover ? 6 : 0 }}>
                <View style={{ aspectRatio: 16 / 9, borderRadius: takeover ? radius.md : radius.lg - 1, borderCurve: 'continuous', overflow: 'hidden', backgroundColor: theme.card }}>
                    {screen}
                    {live && (
                        <Pressable onPress={takeover ? takeover.onOpen : onTakeControl} disabled={takeover?.locked} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [StyleSheet.absoluteFill, { backgroundColor: pressed ? 'rgba(0,0,0,0.25)' : 'transparent' }]}>
                            {site && (
                                <View style={{ position: 'absolute', top: spacing.sm, right: spacing.sm, maxWidth: '60%' }}>
                                    <ScreenPill symbol="globe" label={site} />
                                </View>
                            )}
                            {!takeover?.locked && (
                                <View style={{ position: 'absolute', bottom: spacing.sm, left: spacing.sm }}>
                                    <ScreenPill symbol="mouse-pointer" label={label} />
                                </View>
                            )}
                        </Pressable>
                    )}
                </View>
            </View>
            {takeover && (
                <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border }}>
                    <TakeoverAsk takeover={takeover} />
                </View>
            )}
        </View>
    )
}
