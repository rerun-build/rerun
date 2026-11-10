import type { AiConnectionView, ConnectionUsage, Provider } from '@rerun/contracts'
import * as WebBrowser from 'expo-web-browser'
import type { ReactNode } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTranslations } from 'use-intl'

import type { AccessReason } from '@/auth/access'

import { AppText } from '@/components/ui/AppText'
import { Badge, TONES } from '@/components/ui/Badge'
import { GlassButton, GLASS_BUTTON_SIZE } from '@/components/ui/GlassButton'
import { GROUPED_ROW_HEIGHT } from '@/components/ui/GroupedList'
import { Icon } from '@/components/ui/Icon'
import { ProviderLogo } from '@/components/ui/ProviderLogo'
import { useTheme } from '@/theme/theme'
import { fonts, radius, spacing, withAlpha } from '@/theme/tokens'
import { webHost } from '@/config/environment'
import { signsIn } from './routes'

export const LOGO_TILE = 36

// A form sheet's header lives inside its scroll view: above it, the scroll view covers it.
export function SheetHeader({ title, onBack, onClose }: { title: string; onBack?: () => void; onClose?: () => void }) {
    const t = useTranslations('mobileProviders.sheet')
    return (
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {onBack ? <GlassButton symbol="chevron-left" label={t('back')} onPress={onBack} /> : onClose ? <GlassButton symbol="x" label={t('close')} onPress={onClose} /> : <View style={{ width: GLASS_BUTTON_SIZE }} />}
            <AppText variant="headline" numberOfLines={1} maxFontSizeMultiplier={1.2} style={{ flex: 1, textAlign: 'center', paddingHorizontal: spacing.sm }}>
                {title}
            </AppText>
            <View style={{ width: GLASS_BUTTON_SIZE }} />
        </View>
    )
}

// A form sheet lays out its scroll view itself: wrapped in a view, it is laid out at no height.
export function SheetFrame({ title, onBack, onClose, children }: { title: string; onBack?: () => void; onClose?: () => void; children: ReactNode }) {
    const theme = useTheme()
    const insets = useSafeAreaInsets()
    return (
        <ScrollView style={{ backgroundColor: theme.background }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets contentContainerStyle={{ padding: spacing.lg, paddingTop: spacing.xl, paddingBottom: insets.bottom + spacing.xl, gap: spacing.xl }}>
            <SheetHeader title={title} onBack={onBack} onClose={onClose} />
            {children}
        </ScrollView>
    )
}

export function LogoTile({ provider, size = LOGO_TILE }: { provider: Provider; size?: number }) {
    const theme = useTheme()
    return (
        <View style={{ width: size, height: size, borderRadius: radius.sm + 2, borderCurve: 'continuous', borderWidth: 1, borderColor: theme.border, backgroundColor: theme.background, alignItems: 'center', justifyContent: 'center' }}>
            <ProviderLogo provider={provider} size={Math.round(size * 0.5)} />
        </View>
    )
}

// The web's SourceStatus, word for word.
export function ConnectionBadge({ connection }: { connection: AiConnectionView }) {
    const t = useTranslations('mobileProviders.badge')
    if (connection.status === 'credit_used_up') return <Badge label={t('creditsUsedUp')} tone="red" size="xs" />
    if (connection.status === 'reconnect') return <Badge label={signsIn(connection.provider) ? t('signInAgain') : connection.credentialOnFile ? t('keyRejected') : t('keyMissing')} tone="orange" size="xs" />
    return <Badge label={t('ready')} tone="green" size="xs" />
}

type ProviderRowProps = {
    id: string
    provider: Provider
    title: string
    subtitle?: string
    // 0 lets a subtitle that explains a breakage run as long as it needs.
    subtitleLines?: number
    trailing?: ReactNode
    onPress?: () => void
    // Greyed in place, chevron kept: the action exists, the caller may not take it.
    disabled?: boolean
    children?: ReactNode
}

export function ProviderRow({ id, provider, title, subtitle, subtitleLines = 2, trailing, onPress, disabled, children }: ProviderRowProps) {
    const theme = useTheme()
    return (
        <Pressable testID={id} onPress={onPress} disabled={!onPress || disabled} accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled: !onPress || disabled }} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: GROUPED_ROW_HEIGHT + 12, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, backgroundColor: pressed ? theme.muted : 'transparent', opacity: disabled ? 0.45 : 1 })}>
            <LogoTile provider={provider} />
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <AppText variant="body" medium numberOfLines={1}>
                    {title}
                </AppText>
                {subtitle ? (
                    <AppText variant="footnote" tone="muted" numberOfLines={subtitleLines}>
                        {subtitle}
                    </AppText>
                ) : null}
                {children}
            </View>
            {trailing ? <View style={{ alignSelf: 'center' }}>{trailing}</View> : null}
            {onPress && <Icon name="chevron-right" size={13} bold color={theme.mutedForeground} />}
        </Pressable>
    )
}

// Why the screen opens on its contents without letting them change.
export function ReadOnlyNote({ reason }: { reason: AccessReason | null | undefined }) {
    const t = useTranslations('mobileCoworker.access')
    if (!reason) return null
    return (
        <AppText variant="footnote" tone="muted" style={{ textAlign: 'center' }}>
            {t(reason, { host: webHost })}
        </AppText>
    )
}

// The web's PlanLimitMeter and CreditMeter: brand, orange past 75 %, red past 90 %.
export function UsageBar({ percent }: { percent: number }) {
    const theme = useTheme()
    const tone = percent >= 90 ? theme.destructive : percent >= 75 ? TONES.orange[theme.scheme] : TONES.brand[theme.scheme]
    return (
        <View style={{ height: 4, borderRadius: radius.pill, backgroundColor: theme.muted, overflow: 'hidden' }}>
            <View style={{ width: `${Math.max(2, Math.min(100, percent))}%`, height: '100%', borderRadius: radius.pill, backgroundColor: tone }} />
        </View>
    )
}

export type TrackStep = { title: string; body?: ReactNode }

// The web's ForemanTrack without the orb: numbered steps, the ones behind ticked off.
export function StepTrack({ steps, at, done }: { steps: TrackStep[]; at: number; done: number }) {
    const theme = useTheme()
    return (
        <View style={{ gap: spacing.lg }}>
            {steps.map((step, index) => {
                const ticked = index < done
                const current = index === at
                return (
                    <View key={step.title} style={{ flexDirection: 'row', gap: spacing.md, opacity: ticked || current ? 1 : 0.5 }}>
                        <View style={{ width: 26, height: 26, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: ticked ? withAlpha(TONES.green[theme.scheme], 0.15) : current ? theme.primary : theme.muted }}>
                            {ticked ? (
                                <Icon name="check" size={12} bold color={TONES.green[theme.scheme]} />
                            ) : (
                                <AppText variant="caption" medium maxFontSizeMultiplier={1.2} style={{ color: current ? theme.primaryForeground : theme.mutedForeground }}>
                                    {index + 1}
                                </AppText>
                            )}
                        </View>
                        <View style={{ flex: 1, minWidth: 0, gap: spacing.sm, paddingTop: 3 }}>
                            <AppText variant="callout" medium>
                                {step.title}
                            </AppText>
                            {current && step.body}
                        </View>
                    </View>
                )
            })}
        </View>
    )
}

const INLINE = /(\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*|`[^`]+`)/g

// The steps of PROVIDER_GUIDE: one numbered line each, with links, bold and code.
export function GuideSteps({ steps }: { steps: string }) {
    const theme = useTheme()
    const link = TONES.brand[theme.scheme]
    return (
        <View style={{ gap: spacing.sm }}>
            {steps.split('\n').map(line => (
                <AppText key={line} variant="footnote" tone="muted">
                    {line
                        .split(INLINE)
                        .filter(Boolean)
                        .map((part, index) => {
                            const anchor = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
                            if (anchor)
                                return (
                                    <AppText key={index} variant="footnote" style={{ color: link, textDecorationLine: 'underline' }} onPress={() => WebBrowser.openBrowserAsync(anchor[2])}>
                                        {anchor[1]}
                                    </AppText>
                                )
                            if (part.startsWith('**')) return <AppText key={index} variant="footnote" medium>{part.slice(2, -2)}</AppText>
                            if (part.startsWith('`')) return <AppText key={index} variant="footnote" style={{ fontFamily: fonts.mono }}>{part.slice(1, -1)}</AppText>
                            return part
                        })}
                </AppText>
            ))}
        </View>
    )
}

export function ErrorLine({ error }: { error: string | null }) {
    if (!error) return null
    return (
        <AppText variant="footnote" tone="destructive">
            {error}
        </AppText>
    )
}

type UsageTranslator = ReturnType<typeof useTranslations<'mobileProviders.usage'>>

function movedSentence(usage: ConnectionUsage, t: UsageTranslator): string | null {
    const agents = usage.agents.map(agent => agent.name).join(', ')
    const count = usage.automations.length
    if (agents && count > 0) return t('agentsAndAutomationsFallBack', { agents, count })
    if (agents) return t('agentsFallBack', { agents })
    if (count > 0) return t('automationsFallBack', { count })
    return null
}

// The web's DeleteConnectionButton wording: the delete never refuses, it says what moves.
export function describeUsage(usage: ConnectionUsage, t: UsageTranslator): string {
    const moved = movedSentence(usage, t)
    const sentences = moved ? [moved] : []
    if (usage.isBoxDefault) sentences.push(t('holdsDefault'))
    if (sentences.length === 0) return t('nothingRuns')
    return sentences.join(' ')
}
