import { useLocalSearchParams } from 'expo-router'
import type { ReactNode } from 'react'
import { ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { AlertWidget } from '@/components/chat/hitl/AlertWidget'
import { HitlBlock, UnknownCallBlock } from '@/components/chat/hitl/HitlBlock'
import { McpSignInCard } from '@/components/chat/hitl/McpWidget'
import { PendingHitlPill } from '@/components/chat/hitl/PendingHitlPill'
import { ApprovalReceipt, CancelledReceipt, McpReceipt, QuestionReceipt } from '@/components/chat/hitl/Receipts'
import { AppText } from '@/components/ui/AppText'
import { ThemeScope, useColorSchemeName } from '@/theme/theme'
import { palette, spacing, type ColorScheme } from '@/theme/tokens'

// Dev only: every HITL widget and its receipts on the chat background, without the lab's animated
// buddies. `rerun://lab-hitl?scheme=dark` forces a theme.

const noop = () => {}

const QUESTION = { questions: [{ question: 'Which list should I start with?', options: ['Q4 prospects', 'Q1 renewals', 'Both'] }] }
const QUESTIONS = {
    questions: [
        { question: 'Which channels should I post on?', options: ['LinkedIn', 'X', 'Instagram'], multiple: true },
        { question: 'Anything I should not mention?', options: [] },
    ],
}
const LONG_QUESTIONS = {
    questions: [
        { question: 'Which tone should the post have?', options: ['Friendly', 'Formal'] },
        { question: 'Which of these topics should I cover this week?', options: ['Product launch', 'Customer story', 'Hiring', 'Behind the scenes', 'Industry news', 'Team offsite'], multiple: true },
        { question: 'Anything else I should know before I start?', options: [] },
    ],
}
const APPROVAL_STEPS = {
    approvals: [
        { action: 'Post the launch thread on X' },
        { action: 'Email the 18 beta customers', detail: 'subject: You are in\nlist: beta-customers\nsender: hello@acme.com\n\nHi {{first_name}},\n\nThe new dashboard is live for you today. Reply to this email with anything that feels off.\n\nThanks,\nThe Acme team' },
        { action: 'Archive the old landing page' },
    ],
}
const MANY_APPROVALS = { approvals: Array.from({ length: 9 }, (_, at) => ({ action: `Send follow-up ${at + 1} of 9 to the Q4 prospects` })) }
const APPROVALS = { approvals: [{ action: 'Send the October newsletter to 1,240 subscribers', detail: 'subject: October at Acme\nlist: newsletter-main' }, { action: 'Delete 12 old drafts' }] }
const TAKEOVER = { url: 'https://accounts.google.com/signin', reason: 'Sign in to Google so I can read the shared sheet.' }
const FREE_TEXT = { questions: [{ question: 'What should the subject line say?', options: [] }] }
const LINEAR = { name: 'linear', displayName: 'Linear', host: 'mcp.linear.app', icon: null, status: 'needs_auth' as const, canSignIn: true }
const SECRET = { reason: 'I need your Pipedrive key to sync the deals.', secrets: [{ key: 'PIPEDRIVE_API_KEY', label: 'Pipedrive API key', docsUrl: 'https://pipedrive.readme.io/docs/how-to-find-the-api-token' }] }

const COMPUTER_COMMANDS = { computer: '#studio-pc', reason: 'Encode the rushes of day 2 for the teaser.', commands: ['ffmpeg -i day2.mov -c:v h264_videotoolbox teaser.mp4'], cwd: '~/Projects/client-site-redesign-2026/exports/teasers' }
const COMPUTER_FILES = { computer: '#studio-pc', reason: 'Read the edit list of the teaser.', paths: ['~/Movies/rushes/day2/edit-list.txt'] }

const hitlProps = (toolCallId: string, input: Record<string, unknown>, kind: 'question' | 'approval' | 'secret' | 'takeover' | 'computer' = 'question', output: unknown = undefined) => ({ pending: { kind, toolCallId, input, output }, agentId: 'agent-scout', coworkerName: 'Scout', webUrl: 'https://app.rerun.build', onAnswer: noop, onDismiss: noop })

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

export default function LabHitl() {
    const { scheme: forced } = useLocalSearchParams<{ scheme?: ColorScheme }>()
    const system = useColorSchemeName()
    const scheme = forced === 'dark' || forced === 'light' ? forced : system
    const insets = useSafeAreaInsets()
    return (
        <ThemeScope scheme={scheme}>
            <ScrollView style={{ backgroundColor: palette[scheme].background }} contentContainerStyle={{ paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.xl, paddingHorizontal: spacing.lg, gap: spacing.xl }}>
                <AppText variant="largeTitle">HITL</AppText>
                <Group title="Questions">
                    <HitlBlock {...hitlProps('lab-q1', QUESTION)} />
                    <HitlBlock {...hitlProps('lab-q2', QUESTIONS)} />
                    <HitlBlock {...hitlProps('lab-q3', LONG_QUESTIONS)} />
                    <HitlBlock {...hitlProps('lab-q4', FREE_TEXT)} />
                    <QuestionReceipt
                        answers={[
                            { question: 'Which channels should I post on?', answers: ['LinkedIn', 'X'] },
                            { question: 'Anything I should not mention?', answers: [] },
                        ]}
                    />
                    <CancelledReceipt of="question" />
                </Group>
                <Group title="Approvals and takeover">
                    <HitlBlock {...hitlProps('lab-a1', APPROVALS, 'approval')} />
                    <HitlBlock {...hitlProps('lab-a2', APPROVAL_STEPS, 'approval')} />
                    <HitlBlock {...hitlProps('lab-a3', MANY_APPROVALS, 'approval')} />
                    <HitlBlock {...hitlProps('lab-t1', TAKEOVER, 'takeover')} />
                    <ApprovalReceipt
                        decisions={[
                            { action: 'Send the October newsletter to 1,240 subscribers', decision: 'approved' },
                            { action: 'Delete 12 old drafts', decision: 'declined', note: 'Keep them for now' },
                        ]}
                    />
                </Group>
                <Group title="Linked computers">
                    <HitlBlock {...hitlProps('lab-c1', COMPUTER_COMMANDS, 'computer', { card: { computerId: 'c1', always: { rule: 'program', value: 'ffmpeg', interpreter: false } } })} />
                    <HitlBlock {...hitlProps('lab-c2', COMPUTER_FILES, 'computer', { card: { computerId: 'c1', always: { rule: 'folder', value: '/Users/claire/Movies/rushes/day2', interpreter: false } } })} />
                </Group>
                <Group title="Credentials and notification">
                    <HitlBlock {...hitlProps('lab-s1', SECRET, 'secret')} />
                    <AlertWidget message="The **Q4 report** is ready in your shared folder." onAcknowledge={async () => {}} />
                </Group>
                <Group title="MCP sign-in">
                    <McpSignInCard name="linear" reason="To read the issues of the Q4 board." server={LINEAR} loading={false} busy={false} error={null} onSkip={noop} onConnect={noop} onContinue={noop} />
                    <McpSignInCard name="linear" server={{ ...LINEAR, status: 'connected' }} loading={false} busy={false} error={null} onSkip={noop} onConnect={noop} onContinue={noop} />
                    <McpSignInCard name="mobbin" server={null} loading={false} busy={false} error="This server could not be loaded. Connect it on the web, or skip it." onSkip={noop} onConnect={noop} onContinue={noop} />
                    <McpReceipt name="linear" />
                </Group>
                <Group title="Cue when the block is out of sight">
                    <View style={{ alignItems: 'center', gap: spacing.sm }}>
                        <PendingHitlPill kind="question" input={QUESTIONS} onJump={noop} />
                        <PendingHitlPill kind="approval" input={APPROVAL_STEPS} onJump={noop} />
                        <PendingHitlPill kind="mcp" input={{ name: 'linear' }} onJump={noop} />
                    </View>
                </Group>
                <Group title="What the app cannot draw">
                    <HitlBlock {...hitlProps('lab-f1', { ...QUESTION, v: 9 })} />
                    <UnknownCallBlock call={{ toolCallId: 'lab-u1', toolName: 'request_signature', input: { reason: 'Sign the NDA with Acme before I send the proposal.' } }} coworkerName="Scout" webUrl="https://app.rerun.build" />
                </Group>
            </ScrollView>
        </ThemeScope>
    )
}
