import { SymbolView } from 'expo-symbols'
import type { ReactNode } from 'react'
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native'
import { useTranslations } from 'use-intl'

import { AppText } from '@/components/ui/AppText'
import { BorderBeam } from '@/components/ui/BorderBeam'
import { useTheme } from '@/theme/theme'
import { mix, radius, spacing } from '@/theme/tokens'

import { TakeoverAsk } from './TakeoverAsk'
import type { TakeoverRequestState } from './useTakeoverRequest'

const OVERLAY = 'rgba(0,0,0,0.55)'

function ScreenPill({ symbol, label }: { symbol: 'globe' | 'cursorarrow'; label: string }) {
    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: '100%', paddingHorizontal: 7, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: OVERLAY }}>
            <SymbolView name={symbol} size={11} tintColor="#ffffff" />
            <AppText variant="caption" medium numberOfLines={1} style={{ color: '#ffffff', fontSize: 11, lineHeight: 14, flexShrink: 1 }}>
                {label}
            </AppText>
        </View>
    )
}

type ScreenCardProps = {
    live: boolean
    site: string | null
    // The 16:9 face: the live screen and what covers it until it paints.
    screen: ReactNode
    takeover?: TakeoverRequestState
    onTakeControl: () => void
    onLayout?: (event: LayoutChangeEvent) => void
}

// The web's `ScreenCard`: the coworker's screen as a block of its thread, where the run uses it. A
// takeover the run asks for joins the same block, under a rule. A phone has no hover: what a tap does
// stays written on the screen.
export function ScreenCard({ live, site, screen, takeover, onTakeControl, onLayout }: ScreenCardProps) {
    const theme = useTheme()
    const t = useTranslations('mobileChat.pane')
    const surface = takeover ? mix(theme.card, theme.muted, 0.3) : theme.card
    const label = takeover ? t('openBrowser') : t('takeControl')
    return (
        <View onLayout={onLayout} style={{ width: '95%', borderRadius: radius.lg, borderCurve: 'continuous', borderWidth: 1, borderColor: theme.border, backgroundColor: surface }}>
            {takeover && <BorderBeam tone="brand" radius={radius.lg} surface={surface} />}
            {/* Padded rather than given a margin: Yoga sizes a margined aspect-ratio box off its height. */}
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
                                    <ScreenPill symbol="cursorarrow" label={label} />
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
