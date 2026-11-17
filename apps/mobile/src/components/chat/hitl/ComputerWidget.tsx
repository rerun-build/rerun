import { computerCardFacts, pendingComputerAccess, serializeComputerAccessDecision, type ComputerAccessDecision } from '@rerun/contracts'
import { useRef, useState } from 'react'
import { ScrollView, View } from 'react-native'
import { useTranslations } from 'use-intl'

import { allowOnComputer } from '@/api/computers'
import { useAuth } from '@/auth/AuthProvider'
import { AppText } from '@/components/ui/AppText'
import * as Haptics from '@/lib/haptics'
import { useTheme } from '@/theme/theme'
import { fonts, radius, spacing } from '@/theme/tokens'

import { HitlAction, HitlCard } from './HitlCard'
import type { HitlWidgetProps } from './registry'

// A coworker asks to run commands, or reach files, on a computer linked to the workspace: the web's
// card, answered the same way. "Always allow" is written to the computer before the answer leaves;
// a failed write still answers yes, once.
export function ComputerWidget({ pending, onAnswer }: HitlWidgetProps) {
    const t = useTranslations('mobileHitl')
    const theme = useTheme()
    const { session, me } = useAuth()
    const caller = session && me ? { accessToken: session.access_token, workspaceId: me.workspace.id } : null
    const request = pendingComputerAccess(pending.input)
    const { computerId, always } = computerCardFacts(pending.output)
    const [busy, setBusy] = useState(false)
    const [failed, setFailed] = useState(false)
    const sent = useRef(false)
    const lines = request.commands.length > 0 ? request.commands : request.paths

    const answer = (decision: ComputerAccessDecision) => {
        if (sent.current) return
        sent.current = true
        onAnswer(serializeComputerAccessDecision(decision))
    }

    const decide = async (decision: ComputerAccessDecision['decision'], keep = false) => {
        Haptics.selectionAsync()
        if (!keep || !always || !computerId || !caller) return answer({ computer: request.computer, decision })
        setBusy(true)
        try {
            await allowOnComputer(caller, computerId, always.rule === 'folder' ? { kind: 'folder', folder: always.value } : { kind: 'program', program: always.value })
            answer({ computer: request.computer, decision, always: always.value })
        } catch {
            setFailed(true)
            answer({ computer: request.computer, decision })
        } finally {
            setBusy(false)
        }
    }

    return (
        <HitlCard symbol="shield-check" beam="orange" label={request.commands.length > 0 ? t('computer.runOn', { computer: request.computer }) : t('computer.filesOn', { computer: request.computer })}>
            {request.reason ? <AppText variant="footnote">{request.reason}</AppText> : null}
            <ScrollView style={{ maxHeight: 160, borderRadius: radius.md, backgroundColor: theme.muted }} contentContainerStyle={{ padding: spacing.md, gap: spacing.sm }}>
                {lines.map((line, index) => (
                    <AppText key={index} variant="footnote" style={{ fontFamily: fonts.mono }} selectable>
                        {line}
                    </AppText>
                ))}
            </ScrollView>
            {always?.interpreter && (
                <AppText variant="footnote" tone="muted">
                    {t('computer.interpreterWarning', { program: always.value })}
                </AppText>
            )}
            {failed && (
                <AppText variant="footnote" tone="muted">
                    {t('computer.alwaysFailed')}
                </AppText>
            )}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, justifyContent: 'flex-end' }}>
                <HitlAction label={t('computer.deny')} tone="destructive" disabled={busy} onPress={() => void decide('declined')} />
                {always && computerId && <HitlAction label={always.rule === 'folder' ? t('computer.alwaysFolder') : t('computer.alwaysProgram', { program: always.value })} disabled={busy} onPress={() => void decide('approved', true)} />}
                <HitlAction label={t('computer.allow')} primary disabled={busy} onPress={() => void decide('approved')} />
            </View>
        </HitlCard>
    )
}
