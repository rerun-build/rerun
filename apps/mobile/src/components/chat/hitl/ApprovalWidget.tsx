import { pendingApprovals, serializeApprovalDecisions, type ApprovalDecision } from '@rerun/contracts'
import * as Haptics from 'expo-haptics'
import { useRef, useState } from 'react'
import { ScrollView } from 'react-native'
import { useTranslations } from 'use-intl'

import { AppText } from '@/components/ui/AppText'
import { useTheme } from '@/theme/theme'
import { fonts, radius, spacing } from '@/theme/tokens'

import { DeclineReasonForm } from './DeclineReasonForm'
import { HitlAction, HitlCard } from './HitlCard'
import { HitlSteps } from './HitlSteps'
import type { HitlWidgetProps } from './registry'

// What a coworker asks leave to do, item by item. The reply leaves on its own once every item has an
// answer, written as the web writes it.
export function ApprovalWidget({ pending, onAnswer }: HitlWidgetProps) {
    const t = useTranslations('mobileHitl')
    const theme = useTheme()
    const approvals = pendingApprovals(pending.input)
    const [index, setIndex] = useState(0)
    const [decisions, setDecisions] = useState<(ApprovalDecision | null)[]>(() => approvals.map(() => null))
    const [declining, setDeclining] = useState(false)
    const [note, setNote] = useState('')
    const sent = useRef(false)
    const item = approvals[index]

    const decide = (decision: ApprovalDecision['decision'], note?: string) => {
        Haptics.selectionAsync()
        setDeclining(false)
        const next = decisions.map((current, at) => (at === index ? { ...item, decision, ...(note?.trim() ? { note: note.trim() } : {}) } : current))
        setDecisions(next)
        const open = next.findIndex(entry => entry === null)
        if (open >= 0) {
            setIndex(open)
            return
        }
        if (sent.current) return
        sent.current = true
        onAnswer(serializeApprovalDecisions(next.filter((entry): entry is ApprovalDecision => entry !== null)))
    }

    const startDeclining = () => {
        const current = decisions[index]
        setNote(current?.decision === 'declined' ? (current.note ?? '') : '')
        setDeclining(true)
    }

    const goTo = (at: number) => {
        setDeclining(false)
        setIndex(at)
    }

    if (!item) return null

    return (
        <HitlCard symbol="checkmark.shield" beam="orange" label={t('approval.label')}>
            <HitlSteps
                count={approvals.length}
                index={index}
                onIndexChange={goTo}
                done={at => decisions[at] !== null}
                renderStep={at => {
                    const step = approvals[at]
                    return (
                        <>
                            <AppText variant="body">{step.action}</AppText>
                            {step.detail && (
                                <ScrollView nestedScrollEnabled style={{ maxHeight: 160, borderRadius: radius.md, backgroundColor: theme.muted }} contentContainerStyle={{ padding: spacing.md }}>
                                    <AppText variant="footnote" selectable style={{ fontFamily: fonts.mono }}>
                                        {step.detail}
                                    </AppText>
                                </ScrollView>
                            )}
                        </>
                    )
                }}
                actions={
                    declining ? undefined : (
                        <>
                            <HitlAction label={t('actions.notNow')} tone="destructive" onPress={startDeclining} />
                            <HitlAction label={decisions[index]?.decision === 'approved' ? t('approval.approved') : t('approval.approve')} primary onPress={() => decide('approved')} />
                        </>
                    )
                }
            />
            {declining && <DeclineReasonForm note={note} onNoteChange={setNote} onBack={() => setDeclining(false)} onConfirm={() => decide('declined', note)} />}
        </HitlCard>
    )
}
