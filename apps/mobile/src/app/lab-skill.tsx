import { FOREMAN_DISPLAY_NAME, type MessageFeedbackRating, type SkillProposal, type SkillProposalStatus } from '@rerun/contracts'
import { useLocalSearchParams } from 'expo-router'
import { useState, type ReactNode } from 'react'
import { ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { EventCardView } from '@/components/chat/cards/EventCardView'
import { PinnedSkillProposal, SkillProposalRow } from '@/components/chat/cards/SkillProposalRow'
import { AssistantMessage } from '@/components/chat/Messages'
import { SubRunTree } from '@/components/chat/steps/SubRunTree'
import { AppText } from '@/components/ui/AppText'
import { Button } from '@/components/ui/Button'
import { RUNNING } from '@/mocks/delegate'
import { ThemeScope, useColorSchemeName } from '@/theme/theme'
import { palette, spacing, type ColorScheme } from '@/theme/tokens'

// Dev only: what the chat gained to match the web, a skill proposal in every state, the Brain's
// Undo, a task's Stop and the answer's actions. Taps play the flow locally.
//   /lab-skill?scheme=dark   scheme forces a theme

const PROPOSAL: SkillProposal = {
    id: 'lab-skill',
    sessionId: 'lab',
    toolCallId: 'lab-skill-call',
    mode: 'create',
    slug: null,
    title: 'Deal follow-ups',
    summary: 'Short drafts, no discount.',
    instructions: ['Keep every follow-up under 90 words and never mention pricing unless the user asks for it.', 'Never offer a discount without an explicit go-ahead.'],
    status: 'proposed',
    appliedSlug: null,
    error: null,
    createdAt: '2026-10-26T09:00:00.000Z',
}
const STATES: SkillProposalStatus[] = ['proposed', 'accepted', 'applied', 'failed', 'dismissed']
const WRITE_ERROR = 'The model timed out while writing the skill.'

function Group({ title, children }: { title: string; children: ReactNode }) {
    return (
        <View style={{ gap: spacing.md }}>
            <AppText variant="footnote" tone="muted" medium>
                {title}
            </AppText>
            {children}
        </View>
    )
}

// Remember writes in the background, then lands; No settles at once.
function LiveProposal() {
    const [proposal, setProposal] = useState(PROPOSAL)
    const [pending, setPending] = useState(false)
    const decide = (_: string, decision: 'accept' | 'dismiss') => {
        setPending(true)
        setTimeout(() => {
            setPending(false)
            setProposal(current => ({ ...current, status: decision === 'accept' ? 'accepted' : 'dismissed' }))
            if (decision === 'accept') setTimeout(() => setProposal(current => ({ ...current, status: 'applied' })), 2000)
        }, 600)
    }
    const open = proposal.status === 'proposed' || proposal.status === 'failed'
    return (
        <View style={{ gap: spacing.md }}>
            {open ? <PinnedSkillProposal proposal={proposal} pending={pending} onDecide={decide} /> : <SkillProposalRow proposal={proposal} pending={pending} onDecide={decide} />}
            {!open && (
                <View style={{ alignItems: 'flex-start' }}>
                    <Button size="sm" variant="outline" label="Replay" onPress={() => setProposal(PROPOSAL)} />
                </View>
            )}
        </View>
    )
}

function Actions() {
    const [rating, setRating] = useState<MessageFeedbackRating | null>(null)
    return <AssistantMessage text="I drafted a follow-up for each of the **23 quiet deals** in `drafts/follow-ups/`." showActions actions={{ onRegenerate: () => {}, rating, onRate: next => setRating(current => (current === next ? null : next)) }} />
}

export default function LabSkill() {
    const { scheme: forced } = useLocalSearchParams<{ scheme?: ColorScheme }>()
    const system = useColorSchemeName()
    const scheme = forced === 'dark' || forced === 'light' ? forced : system
    const insets = useSafeAreaInsets()
    return (
        <ThemeScope scheme={scheme}>
            <ScrollView style={{ backgroundColor: palette[scheme].background }} contentContainerStyle={{ paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.xl, paddingHorizontal: spacing.lg, gap: spacing.xl }}>
                <AppText variant="largeTitle">Chat parity</AppText>
                <Group title="Skill proposal, pinned above the composer (tap the text, then decide)">
                    <LiveProposal />
                </Group>
                <Group title="Skill proposal in the transcript, every state">
                    {STATES.map(status => (
                        <SkillProposalRow key={status} proposal={{ ...PROPOSAL, id: status, status, error: status === 'failed' ? WRITE_ERROR : null }} pending={false} onDecide={() => {}} />
                    ))}
                </Group>
                <Group title="Brain change with Undo">
                    <EventCardView card={{ kind: 'brain-change', change: { status: 'saved', slug: 'pricing', title: 'Pricing', mode: 'edit', undoRevisionId: 'rev-1', hash: 'h1' } }} coworkerName={FOREMAN_DISPLAY_NAME} />
                </Group>
                <Group title="Delegation, a task can be stopped">
                    <SubRunTree tasks={RUNNING} onStopTask={() => {}} />
                </Group>
                <Group title="Answer actions">
                    <Actions />
                </Group>
            </ScrollView>
        </ThemeScope>
    )
}
