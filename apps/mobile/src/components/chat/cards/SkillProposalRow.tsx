import type { SkillProposal, SkillProposalDecision } from '@rerun/contracts'
import { SymbolView } from 'expo-symbols'
import { useState } from 'react'
import { ActivityIndicator, Pressable, View } from 'react-native'
import Animated from 'react-native-reanimated'
import { useTranslations } from 'use-intl'

import { AppText } from '@/components/ui/AppText'
import { Badge, TONES } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { IconTile } from '@/components/ui/IconTile'
import { layoutTransition } from '@/theme/motion'
import { useTheme } from '@/theme/theme'
import { radius, spacing } from '@/theme/tokens'

import { EventRow } from './EventCardView'

type Copy = { headline: string; detail: string; accept?: string; dismiss?: string }

type SkillTranslator = ReturnType<typeof useTranslations<'mobileCards.skill'>>

// The web's copy (SkillProposalBlock), state by state.
function copyFor({ title, summary, status, instructions, error }: SkillProposal, t: SkillTranslator): Copy {
    const firstRule = instructions[0] || summary
    if (status === 'accepted') return { headline: t('remembering'), detail: firstRule }
    if (status === 'applied') return { headline: t('remembered'), detail: title }
    if (status === 'failed') return { headline: t('failed'), detail: error || title, accept: t('retry'), dismiss: t('dismiss') }
    if (status === 'dismissed') return { headline: t('notRemembered'), detail: title }
    return { headline: t('ask'), detail: firstRule, accept: t('remember'), dismiss: t('no') }
}

type SkillProposalRowProps = {
    proposal: SkillProposal
    pending: boolean
    onDecide: (proposalId: string, decision: SkillProposalDecision) => void
}

function Decision({ proposal, pending, onDecide, copy }: SkillProposalRowProps & { copy: Copy }) {
    if (!copy.accept || !copy.dismiss) return null
    return (
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.sm }}>
            <Button size="sm" variant="ghost" label={copy.dismiss} disabled={pending} onPress={() => onDecide(proposal.id, 'dismiss')} />
            <Button size="sm" label={copy.accept} loading={pending} onPress={() => onDecide(proposal.id, 'accept')} />
        </View>
    )
}

function Outcome({ status }: { status: SkillProposal['status'] }) {
    const theme = useTheme()
    if (status === 'accepted') return <ActivityIndicator size="small" color={theme.mutedForeground} />
    if (status === 'applied') return <SymbolView name="checkmark.circle.fill" size={18} tintColor={TONES.green[theme.scheme]} />
    if (status === 'dismissed') return <SymbolView name="xmark.circle.fill" size={18} tintColor={theme.mutedForeground} />
    return null
}

// A rule the coworker offered to remember, where the transcript raised it. It never pauses the run:
// accepting starts the writing, and the same row reports how it went.
export function SkillProposalRow({ proposal, pending, onDecide }: SkillProposalRowProps) {
    const t = useTranslations('mobileCards.skill')
    const copy = copyFor(proposal, t)
    return (
        <EventRow symbol="brain" title={copy.headline} note={copy.detail} trailing={<Outcome status={proposal.status} />}>
            <Decision proposal={proposal} pending={pending} onDecide={onDecide} copy={copy} />
        </EventRow>
    )
}

// The same proposal pinned above the composer while it waits on a decision. Its second line unfolds
// into the rules exactly as the coworker worded them, what accepting writes into the skill.
export function PinnedSkillProposal({ proposal, pending, onDecide }: SkillProposalRowProps) {
    const t = useTranslations('mobileCards.skill')
    const theme = useTheme()
    const [expanded, setExpanded] = useState(false)
    const copy = copyFor(proposal, t)
    const failed = proposal.status === 'failed'
    const { instructions } = proposal
    return (
        <Animated.View layout={layoutTransition} style={{ padding: spacing.md, borderRadius: radius.lg, borderCurve: 'continuous', borderWidth: 1, borderColor: theme.border, backgroundColor: theme.card }}>
            <View style={{ flexDirection: 'row', alignItems: expanded ? 'flex-start' : 'center', gap: spacing.md }}>
                <IconTile symbol="brain" />
                <Pressable onPress={() => setExpanded(!expanded)} accessibilityRole="button" accessibilityLabel={expanded ? t('hideDetails') : t('showDetails')} accessibilityState={{ expanded }} style={{ flex: 1, gap: 2 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                        <AppText variant="callout" medium numberOfLines={expanded ? undefined : 1} style={{ flexShrink: 1 }}>
                            {copy.headline}
                        </AppText>
                        <SymbolView name="chevron.down" size={11} weight="semibold" tintColor={theme.mutedForeground} style={{ transform: [{ rotate: expanded ? '180deg' : '0deg' }] }} />
                    </View>
                    {expanded ? (
                        <View style={{ gap: spacing.xs }}>
                            {(failed || instructions.length === 0) && (
                                <AppText variant="footnote" tone={failed ? 'destructive' : 'muted'}>
                                    {copy.detail}
                                </AppText>
                            )}
                            {instructions.map((instruction, index) => (
                                <AppText key={index} variant="footnote" tone="muted">
                                    {instruction}
                                </AppText>
                            ))}
                        </View>
                    ) : (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                            <AppText variant="footnote" tone={failed ? 'destructive' : 'muted'} numberOfLines={1} style={{ flexShrink: 1 }}>
                                {copy.detail}
                            </AppText>
                            {!failed && instructions.length > 1 && <Badge size="xs" label={`+${instructions.length - 1}`} />}
                        </View>
                    )}
                </Pressable>
                <Outcome status={proposal.status} />
            </View>
            <Decision proposal={proposal} pending={pending} onDecide={onDecide} copy={copy} />
        </Animated.View>
    )
}
