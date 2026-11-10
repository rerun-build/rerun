import type { PaidSource, PaidSourceLine, PaidTurnSources } from '@rerun/contracts'
import { Image } from 'expo-image'
import { SymbolView } from 'expo-symbols'
import { Fragment, useState } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTranslations } from 'use-intl'

import { AppText } from '@/components/ui/AppText'
import { Badge } from '@/components/ui/Badge'
import { GlassButton } from '@/components/ui/GlassButton'
import { Card, Separator } from '@/components/ui/GroupedList'
import { faviconUrl } from '@/lib/url'
import { useTheme } from '@/theme/theme'
import { radius, spacing } from '@/theme/tokens'

const PILL_HEIGHT = 28
const FACEPILE_SIZE = 16
const ROW_LOGO_SIZE = 24
const MAX_STACKED = 4

function SourceLogo({ source, size, ring }: { source: PaidSource; size: number; ring?: string }) {
    const theme = useTheme()
    const frame = { width: size, height: size, borderRadius: 4, borderCurve: 'continuous' as const, overflow: 'hidden' as const, borderWidth: ring ? 1.5 : StyleSheet.hairlineWidth, borderColor: ring ?? theme.border }
    if (!source.domain) {
        return (
            <View style={[frame, { alignItems: 'center', justifyContent: 'center', backgroundColor: theme.muted }]}>
                <SymbolView name="globe" size={size * 0.62} tintColor={theme.mutedForeground} />
            </View>
        )
    }
    return <Image source={{ uri: faviconUrl(source.domain) }} accessibilityLabel={source.name} contentFit="contain" style={[frame, { backgroundColor: '#ffffff' }]} />
}

function Facepile({ sources }: { sources: PaidSource[] }) {
    const theme = useTheme()
    return (
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {sources.slice(0, MAX_STACKED).map((source, i) => (
                <View key={source.id} style={{ marginLeft: i > 0 ? -4 : 0 }}>
                    <SourceLogo source={source} size={FACEPILE_SIZE} ring={theme.background} />
                </View>
            ))}
        </View>
    )
}

function SourceRow({ line }: { line: PaidSourceLine }) {
    const t = useTranslations('tools')
    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md }}>
            <SourceLogo source={line.source} size={ROW_LOGO_SIZE} />
            <View style={{ flex: 1, minWidth: 0 }}>
                <AppText variant="callout" numberOfLines={1}>
                    {line.source.name}
                </AppText>
                <AppText variant="caption" tone="muted" numberOfLines={1}>
                    {t(`paidData.${line.capability}`)}
                </AppText>
            </View>
            <View style={{ alignItems: 'flex-end', flexShrink: 0 }}>
                <AppText variant="callout" style={{ fontVariant: ['tabular-nums'] }}>
                    {line.found}
                    <AppText variant="callout" tone="muted">{`/${line.asked}`}</AppText>
                </AppText>
                <AppText variant="caption" tone="muted" numberOfLines={1}>
                    {line.label}
                </AppText>
            </View>
        </View>
    )
}

function SourcesSheet({ turn, open, onClose }: { turn: PaidTurnSources; open: boolean; onClose: () => void }) {
    const theme = useTheme()
    const insets = useSafeAreaInsets()
    const t = useTranslations('mobileChat.paidSources')
    const tc = useTranslations('mobileCommon.actions')
    const { checked, valid } = turn.emails
    return (
        <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
            <View style={{ flex: 1, backgroundColor: theme.background }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.md }}>
                    <AppText variant="headline" numberOfLines={1} style={{ flex: 1 }}>
                        {t('title')}
                    </AppText>
                    <GlassButton symbol="xmark" label={tc('close')} onPress={onClose} />
                </View>
                <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: insets.bottom + spacing.xl, gap: spacing.md }}>
                    <Card>
                        {turn.lines.map((line, index) => (
                            <Fragment key={`${line.source.id}|${line.capability}`}>
                                {index > 0 && <Separator inset={spacing.lg + ROW_LOGO_SIZE + spacing.md} />}
                                <SourceRow line={line} />
                            </Fragment>
                        ))}
                    </Card>
                    {checked > 0 && <Badge tone={valid === checked ? 'green' : 'neutral'} label={t('emailsVerified', { valid, checked })} />}
                </ScrollView>
            </View>
        </Modal>
    )
}

// The web's source pill under a reply that bought data: the logos of where it came from, the detail in a sheet.
export function PaidSourcesPill({ turn }: { turn: PaidTurnSources }) {
    const theme = useTheme()
    const [open, setOpen] = useState(false)
    const t = useTranslations('mobileChat.paidSources')
    const label = t('count', { count: turn.sources.length })
    return (
        <>
            <Pressable
                onPress={() => setOpen(true)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={label}
                style={({ pressed }) => ({ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, height: PILL_HEIGHT, paddingLeft: 6, paddingRight: spacing.md, borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border, backgroundColor: pressed ? theme.muted : theme.background })}
            >
                <Facepile sources={turn.sources} />
                <AppText variant="caption" tone="muted" style={{ fontVariant: ['tabular-nums'] }}>
                    {label}
                </AppText>
            </Pressable>
            <SourcesSheet turn={turn} open={open} onClose={() => setOpen(false)} />
        </>
    )
}
