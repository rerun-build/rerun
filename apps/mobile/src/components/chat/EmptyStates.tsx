import { teamEmptyStateOf, type TeamEmptyStateAction, type TeamEmptyStateCopy, type TeamEmptyStateModel, type TeamEmptyStateRow, type TeamPulse } from '@rerun/contracts'
import { useMemo } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { useTranslations } from 'use-intl'

import { useAuth } from '@/auth/AuthProvider'
import { AgentBuddy } from '@/components/buddy/AgentBuddy'
import type { BuddyMood } from '@/components/buddy/look'
import { ForemanOrb } from '@/components/orb/ForemanOrb'
import { AppText } from '@/components/ui/AppText'
import { Icon, type IconName } from '@/components/ui/Icon'
import { Skeleton } from '@/components/ui/Skeleton'
import { useWorkspaceAgents } from '@/data/useWorkspaceAgents'
import { useTheme } from '@/theme/theme'
import { radius, spacing } from '@/theme/tokens'

const PULSE_BUDDIES = 6
const STARTER_KEYS = ['capabilities', 'recentWork', 'projectFiles', 'tools'] as const
const ROW_SYMBOLS: Record<Exclude<TeamEmptyStateRow['leading'], 'agent'>, IconName> = { build: 'wand', template: 'layers', guide: 'book' }

function StarterChip({ text, onPress }: { text: string; onPress: () => void }) {
    const theme = useTheme()
    return (
        <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => ({ paddingHorizontal: spacing.lg - 2, paddingVertical: spacing.sm + 2, borderRadius: radius.pill, borderWidth: 1, borderColor: theme.border, backgroundColor: pressed ? theme.muted : theme.card })}>
            <AppText variant="footnote">{text}</AppText>
        </Pressable>
    )
}

/**
 * The web's empty conversation with a coworker (AgentChat): its buddy, an invitation, and the four
 * starter questions, each sent on a tap. A coworker turned off says that a message wakes it.
 */
export function CoworkerEmptyState({ agentId, mood, asleep, onSend }: { agentId: string; mood: BuddyMood; asleep: boolean; onSend: (text: string) => void }) {
    const t = useTranslations('mobileChat.empty')
    return (
        <View style={{ alignItems: 'center', gap: spacing.lg, paddingHorizontal: spacing.md }}>
            <AgentBuddy agentId={agentId} size={96} mood={mood} />
            <View style={{ alignItems: 'center', gap: 2 }}>
                <AppText variant="headline">{t('startTitle')}</AppText>
                <AppText variant="callout" tone="muted" style={{ textAlign: 'center' }}>
                    {asleep ? t('asleep') : t('sendToCoworker')}
                </AppText>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.sm }}>
                {STARTER_KEYS.map(key => (
                    <StarterChip key={key} text={t(`starters.${key}`)} onPress={() => onSend(t(`starters.${key}`))} />
                ))}
            </View>
        </View>
    )
}

function Pulse({ pulse }: { pulse: TeamPulse }) {
    const t = useTranslations('mobileChat.empty')
    const count = pulse.agents.length
    return (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: spacing.sm }}>
            <View style={{ flexDirection: 'row' }}>
                {pulse.agents.slice(0, PULSE_BUDDIES).map((agent, i) => (
                    <View key={agent.id} style={{ marginLeft: i === 0 ? 0 : -6 }}>
                        <AgentBuddy agentId={agent.id} size={22} mood={agent.working ? 'working' : 'idle'} animated={false} facing="right" />
                    </View>
                ))}
            </View>
            <AppText variant="footnote" tone="muted">
                {t('pulseCoworkers', { count })}
                {pulse.working > 0 ? (
                    <AppText variant="footnote" style={{ color: '#10b981' }}>
                        {` · ${t('pulseWorking', { count: pulse.working })}`}
                    </AppText>
                ) : null}
            </AppText>
        </View>
    )
}

function RowLeading({ row }: { row: TeamEmptyStateRow }) {
    const theme = useTheme()
    if (row.leading === 'agent') return <AgentBuddy agentId={row.agentId} size={32} mood={row.working ? 'working' : 'idle'} animated={false} facing="right" />
    return (
        <View style={{ width: 32, height: 32, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.muted }}>
            <Icon name={ROW_SYMBOLS[row.leading]} size={15} color={theme.mutedForeground} />
        </View>
    )
}

// The Foreman's empty conversation (ForemanTeamEmptyState on the web): a greeting, the team at a
// glance, and three things to ask, each sent or written into the composer.
export function ForemanEmptyStateView({ model, onSend, onPrefill }: { model: TeamEmptyStateModel; onSend: (text: string) => void; onPrefill: (text: string) => void }) {
    const theme = useTheme()
    const run = (action: TeamEmptyStateAction) => (action.type === 'send' ? onSend : onPrefill)(action.text)
    return (
        <View style={{ alignItems: 'center', gap: spacing.lg }}>
            <ForemanOrb size={84} />
            <View style={{ alignItems: 'center', gap: 2, paddingHorizontal: spacing.md }}>
                <AppText variant="headline" style={{ textAlign: 'center' }}>
                    {model.title}
                </AppText>
                {model.subtitle ? (
                    <AppText variant="callout" tone="muted" style={{ textAlign: 'center' }}>
                        {model.subtitle}
                    </AppText>
                ) : null}
            </View>
            {model.pulse && <Pulse pulse={model.pulse} />}
            <View style={{ alignSelf: 'stretch', gap: spacing.sm }}>
                {model.rows.map(row => (
                    <Pressable
                        key={row.id}
                        onPress={() => run(row.action)}
                        accessibilityRole="button"
                        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2, borderRadius: radius.lg, borderCurve: 'continuous', borderWidth: StyleSheet.hairlineWidth * 2, borderColor: theme.border, backgroundColor: pressed ? theme.muted : theme.card })}
                    >
                        <RowLeading row={row} />
                        <View style={{ flex: 1, gap: 1 }}>
                            <AppText variant="callout" medium numberOfLines={1}>
                                {row.title}
                            </AppText>
                            <AppText variant="footnote" tone="muted" numberOfLines={1}>
                                {row.description}
                            </AppText>
                        </View>
                    </Pressable>
                ))}
            </View>
        </View>
    )
}

// Drawn after the view: the orb, a title line and three rows.
function ForemanEmptyStateSkeleton() {
    const t = useTranslations('mobileChat.empty')
    return (
        <View accessible accessibilityLabel={t('loading')} style={{ alignItems: 'center', gap: spacing.lg }}>
            <Skeleton style={{ width: 84, height: 84, borderRadius: 42 }} />
            <Skeleton style={{ width: 220, height: 16 }} />
            <View style={{ alignSelf: 'stretch', gap: spacing.sm }}>
                {[0, 1, 2].map(row => (
                    <Skeleton key={row} style={{ height: 58, borderRadius: radius.lg }} />
                ))}
            </View>
        </View>
    )
}

function useTeamEmptyStateCopy(): TeamEmptyStateCopy {
    const t = useTranslations('mobileChat.empty.team')
    return useMemo<TeamEmptyStateCopy>(
        () => ({
            greeting: name => (name ? t('greetingNamed', { firstName: name }) : t('greeting')),
            greetingWithTeam: greeting => t('greetingWithTeam', { greeting }),
            emptySubtitle: t('emptySubtitle'),
            buildPrompt: t('buildPrompt'),
            buildFirst: { title: t('buildFirst.title'), description: t('buildFirst.description') },
            template: { title: t('template.title'), description: t('template.description'), send: t('template.send') },
            guide: { title: t('guide.title'), description: t('guide.description'), send: t('guide.send') },
            checkWorking: (name, mention) => ({ title: t('checkWorking.title', { name }), description: t('checkWorking.description'), send: t('checkWorking.send', { mention }) }),
            checkIdle: (name, mention) => ({ title: t('checkIdle.title', { name }), description: t('checkIdle.description'), send: t('checkIdle.send', { mention }) }),
            handOff: (name, mention) => ({ title: t('handOff.title', { name }), description: t('handOff.description'), prefill: t('handOff.prefill', { mention }) }),
            build: { title: t('build.title'), description: t('build.description') },
        }),
        [t]
    )
}

// Null agents until the workspace is read: an empty list before that would greet someone who has a
// team with the "no coworkers yet" screen.
export function ForemanEmptyState({ onSend, onPrefill }: { onSend: (text: string) => void; onPrefill: (text: string) => void }) {
    const { me } = useAuth()
    const agents = useWorkspaceAgents()
    const copy = useTeamEmptyStateCopy()
    if (!agents) return <ForemanEmptyStateSkeleton />
    const firstName = me?.user.name?.trim().split(/\s+/)[0] ?? ''
    return <ForemanEmptyStateView model={teamEmptyStateOf({ agents, nextRoutine: null, firstName, copy })} onSend={onSend} onPrefill={onPrefill} />
}
