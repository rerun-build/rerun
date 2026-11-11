import { creditsFromMicros, formatCredits, pendingSpend, readSpendQuote, serializeSpendDecision, type SpendDecision } from '@rerun/contracts'
import { useRef, useState } from 'react'
import { View } from 'react-native'
import { useLocale, useTranslations } from 'use-intl'

import { setPaidDataAlwaysAllow } from '@/api/paid-data'
import { useAuth } from '@/auth/AuthProvider'
import { AppText } from '@/components/ui/AppText'
import * as Haptics from '@/lib/haptics'
import { openExternalUrl } from '@/lib/url'
import { useTheme } from '@/theme/theme'
import { radius, spacing } from '@/theme/tokens'

import { HitlAction, HitlCard } from './HitlCard'
import type { HitlWidgetProps } from './registry'

// What a coworker asks leave to spend on paid data, priced by the hub, answered the way the web
// answers it. "Not now" declines at once: the coworker finishes with its free tools.
export function SpendWidget({ pending, agentId, onAnswer, webUrl }: HitlWidgetProps) {
    const t = useTranslations('mobileHitl')
    const tTools = useTranslations('tools')
    const locale = useLocale()
    const theme = useTheme()
    const { session, me } = useAuth()
    const caller = session && me ? { accessToken: session.access_token, workspaceId: me.workspace.id } : null
    const [busy, setBusy] = useState(false)
    const [failed, setFailed] = useState(false)
    const sent = useRef(false)
    const quote = readSpendQuote(pending.output)
    if (!quote) return null
    const request = pendingSpend(pending.input)
    // The credit the workspace had when the hub priced it: the app does not follow the balance live,
    // the web card does, and topping up happens there.
    const short = quote.totalMicros > quote.creditLeftMicros

    const answer = (decision: SpendDecision) => {
        if (sent.current) return
        sent.current = true
        onAnswer(serializeSpendDecision(decision))
    }

    const decide = async (decision: SpendDecision['decision'], always = false) => {
        Haptics.selectionAsync()
        if (!always || !caller) return answer({ purpose: request.purpose, decision })
        setBusy(true)
        try {
            await setPaidDataAlwaysAllow(caller, agentId, true)
            answer({ purpose: request.purpose, decision, always: true })
        } catch {
            // The approval still stands, held to its estimate: only the setting could not be written.
            setFailed(true)
            answer({ purpose: request.purpose, decision })
        } finally {
            setBusy(false)
        }
    }

    return (
        <HitlCard symbol="circle-dollar-sign" beam="orange" label={request.purpose}>
            {request.soFar && (
                <AppText variant="footnote" tone="muted">
                    {request.soFar}
                </AppText>
            )}
            <View style={{ gap: spacing.xs, padding: spacing.md, borderRadius: radius.md, backgroundColor: theme.muted }}>
                {quote.lines.map((line, index) => (
                    <View key={index} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                        <AppText variant="footnote" numberOfLines={1} style={{ flex: 1 }}>
                            {tTools(`paidData.${line.capability}`)}
                        </AppText>
                        <AppText variant="caption" tone="muted">
                            ×{line.units}
                        </AppText>
                        <AppText variant="footnote" tone="muted" style={{ minWidth: 40, textAlign: 'right' }}>
                            {formatCredits(line.micros, locale)}
                        </AppText>
                    </View>
                ))}
                <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.sm, paddingTop: spacing.xs, borderTopWidth: 1, borderTopColor: theme.border }}>
                    <AppText variant="caption" tone="muted">
                        {t('spend.estimatedTotal')}
                    </AppText>
                    <AppText variant="callout" medium>
                        ~{formatCredits(quote.totalMicros, locale)} {t('spend.creditsUnit', { count: creditsFromMicros(quote.totalMicros) })}
                    </AppText>
                </View>
            </View>
            {short && (
                <AppText variant="footnote" tone="destructive">
                    {t('spend.creditsShort', { amount: formatCredits(quote.creditLeftMicros, locale), count: creditsFromMicros(quote.creditLeftMicros) })}
                </AppText>
            )}
            {failed && (
                <AppText variant="footnote" tone="muted">
                    {t('spend.alwaysAllowFailed')}
                </AppText>
            )}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, justifyContent: 'flex-end' }}>
                <HitlAction label={t('actions.notNow')} tone="destructive" disabled={busy} onPress={() => void decide('declined')} />
                {short ? (
                    <HitlAction label={t('spend.addCredits')} primary onPress={() => openExternalUrl(webUrl)} />
                ) : (
                    <>
                        <HitlAction label={t('spend.alwaysAllow')} disabled={busy} onPress={() => void decide('approved', true)} />
                        <HitlAction label={t('spend.approveOnce')} primary disabled={busy} onPress={() => void decide('approved')} />
                    </>
                )}
            </View>
        </HitlCard>
    )
}
