import type { InboxItem, SkillProposal, SkillProposalStatus, WorkspaceSummary } from '@rerun/contracts'
import { GlassView } from 'expo-glass-effect'
import { Link, type Href } from 'expo-router'
import type { ReactNode } from 'react'
import { ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { AgentBuddy } from '@/components/buddy/AgentBuddy'
import { ChipPage, type ChatTab } from '@/components/chat/ChatHeader'
import { Composer } from '@/components/chat/Composer'
import { ConversationSkeleton } from '@/components/chat/ConversationSkeleton'
import { ModelChip, RoundButton } from '@/components/chat/ComposerControls'
import { RunStatus } from '@/components/chat/RunStatus'
import type { VoiceMessageError, VoiceSender } from '@/components/chat/useVoiceMessage'
import { VoiceUserMessage } from '@/components/chat/VoiceUserMessage'
import { VoiceRecorderBar } from '@/components/chat/VoiceRecorderBar'
import { EventCardView } from '@/components/chat/cards/EventCardView'
import { PinnedSkillProposal, SkillProposalRow } from '@/components/chat/cards/SkillProposalRow'
import { FileCardView } from '@/components/chat/cards/FileCardView'
import { Sources } from '@/components/chat/cards/Sources'
import { AlertWidget } from '@/components/chat/hitl/AlertWidget'
import { TableCardView } from '@/components/chat/cards/TableCardView'
import { HitlBlock, UnknownCallBlock } from '@/components/chat/hitl/HitlBlock'
import { ApprovalReceipt, CancelledReceipt, QuestionReceipt } from '@/components/chat/hitl/Receipts'
import { CoworkerRow } from '@/components/home/CoworkerRow'
import { InboxButton } from '@/components/home/InboxButton'
import { InboxRow } from '@/components/inbox/InboxRow'
import { SectionHeader } from '@/components/home/SectionHeader'
import { WorkspaceMenuView } from '@/components/home/WorkspaceMenu'
import { BUDDY_MOODS } from '@/components/buddy/look'
import { CodeField } from '@/components/auth/CodeField'
import { PhoneField } from '@/components/auth/PhoneField'
import { ForemanOrb } from '@/components/orb/ForemanOrb'
import { PillButton } from '@/components/ui/PillButton'
import { UpdateRequired } from '@/components/update/UpdateRequired'
import { AppText } from '@/components/ui/AppText'
import { Badge, type BadgeTone } from '@/components/ui/Badge'
import { Button, type ButtonVariant } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { GLASS_BUTTON_SIZE } from '@/components/ui/GlassButton'
import { TextField } from '@/components/ui/TextField'
import { statusLine } from '@/components/ui/status'
import { environment } from '@/config/environment'
import { type Coworker, coworkers, MOCK_TRANSCRIPT, MOCK_VOICE_PEAKS, sessions } from '@/mocks/data'
import { findModel } from '@/mocks/models'
import { ThemeScope, useTheme } from '@/theme/theme'
import { palette, radius, spacing, type ColorScheme } from '@/theme/tokens'

// Dev only: every piece of the app in both themes, and a door to each screen in each state. This is
// where the design is judged before anything is wired to the API.
const SIZES = [20, 44, 72]
const SAMPLE_IDS = ['agent-scout', 'agent-inbox', 'agent-ledger', 'agent-pulse', 'agent-recap', 'cw-inbox']

const SCREENS: { label: string; href: Href }[] = [
    { label: 'Home', href: '/' },
    { label: 'Splash, skeleton fills', href: '/lab-splash' },
    { label: 'Home, 3 pinned', href: '/lab-home?pins=3' },
    { label: 'Home, 5 pinned, dark', href: '/lab-home?pins=5&scheme=dark' },
    { label: 'Home, 9 pinned', href: '/lab-home?pins=9' },
    { label: 'Home, nothing pinned', href: '/lab-home?pins=0' },
    { label: 'Rerun, last conversation', href: '/chat/last' },
    { label: 'Rerun, new conversation', href: '/chat/new' },
    { label: 'New coworker', href: '/new-coworker' },
    { label: 'Notifications', href: '/inbox' },
    { label: 'Sign-in sheet', href: '/lab-sign-in' },
    { label: 'Coworker screen in the chat', href: '/lab-screen' },
    { label: 'Coworker screen in the chat, dark', href: '/lab-screen?scheme=dark' },
    { label: 'Onboarding, website', href: '/lab-onboarding?step=company' },
    { label: 'Onboarding, line of work', href: '/lab-onboarding?step=industry' },
    { label: 'Onboarding, role', href: '/lab-onboarding?step=role' },
    { label: 'Onboarding, first name', href: '/lab-onboarding?step=name' },
    { label: 'Onboarding, starter team', href: '/lab-onboarding?step=pack' },
    { label: 'Onboarding, question', href: '/lab-onboarding?step=choice' },
    { label: 'Onboarding, either', href: '/lab-onboarding?step=either' },
    { label: 'Onboarding, plan', href: '/lab-onboarding?step=plan' },
    { label: 'Onboarding, starting', href: '/lab-onboarding?step=trial' },
    { label: 'Onboarding, start failed', href: '/lab-onboarding?step=failed' },
    { label: 'Onboarding, building', href: '/lab-onboarding?step=building' },
    { label: 'Onboarding, built', href: '/lab-onboarding?step=built' },
    { label: 'Onboarding, waitlist', href: '/lab-onboarding?step=waitlist' },
    { label: 'AI consent', href: '/lab-consent' },
    { label: 'AI consent, dark', href: '/lab-consent?scheme=dark' },
    { label: 'Markdown, text', href: '/lab-markdown?part=1' },
    { label: 'Markdown, code, tables, media', href: '/lab-markdown?part=2' },
    { label: 'Markdown, streaming', href: '/lab-markdown?part=stream' },
    { label: 'Steps, folded', href: '/lab-markdown?part=steps' },
    { label: 'Steps, running', href: '/lab-markdown?part=running' },
    { label: 'Tool steps', href: '/lab-steps' },
    { label: 'Tool steps, dark', href: '/lab-steps?scheme=dark' },
    { label: 'Paid data sources', href: '/lab-steps?scenario=paid' },
    { label: 'Cards: sub-runs, apps, compaction', href: '/lab-markdown?part=cards' },
    { label: 'Origins: webhook, routine, install', href: '/lab-markdown?part=origins' },
    { label: 'Authors: photo, initials, former member', href: '/lab-markdown?part=authors' },
    { label: 'Viewer: photos, PDF', href: '/lab-markdown?part=viewer' },
    { label: 'Message times, light', href: '/lab-message-times' },
    { label: 'Message times, dark', href: '/lab-message-times?scheme=dark' },
    { label: 'Rerun on the Home', href: '/lab-foreman' },
    { label: 'Rerun chat, conversation', href: '/lab-chat?coworker=foreman&tabs=1&state=conversation' },
    { label: 'Rerun chat, running', href: '/lab-chat?coworker=foreman&tabs=1&state=running' },
    { label: 'Rerun chat, question', href: '/lab-chat?coworker=foreman&tabs=1&state=question' },
    { label: 'Rerun chat, empty', href: '/lab-chat?coworker=foreman&tabs=0' },
    { label: 'Rerun chat, streaming', href: '/lab-chat?coworker=foreman&tabs=1&state=streaming' },
    { label: 'Rerun chat, loading', href: '/lab-chat?coworker=foreman&tabs=1&state=loading' },
    { label: 'Chat, 1 tab', href: '/lab-chat?tabs=1' },
    { label: 'Chat, 3 tabs, first active', href: '/lab-chat?tabs=3&active=0' },
    { label: 'Chat, 6 tabs, middle active', href: '/lab-chat?tabs=6&active=3' },
    { label: 'Chat, 6 tabs, last active', href: '/lab-chat?tabs=6&active=5' },
    { label: 'Chat, streaming', href: '/lab-chat?tabs=3&active=1&state=streaming' },
    { label: 'Chat, loading', href: '/lab-chat?tabs=3&active=1&state=loading' },
    { label: 'Chat, approval', href: '/lab-chat?tabs=3&active=1&state=approval' },
    { label: 'Conversations A, native menu', href: '/lab-conversations?variant=a' },
    { label: 'Conversations B, sheet by date', href: '/lab-conversations?variant=b' },
    { label: 'Conversations C, sheet by state', href: '/lab-conversations?variant=c' },
    { label: 'Coworker details', href: '/lab-coworker?state=normal' },
    { label: 'Coworker details, loading', href: '/lab-coworker?state=loading' },
    { label: 'Coworker details, apps to connect', href: '/lab-coworker?state=to-connect' },
    { label: 'Coworker details, nothing yet', href: '/lab-coworker?state=empty' },
    { label: 'Coworker details, switched off', href: '/lab-coworker?state=off' },
    { label: 'Coworker details, muted', href: '/lab-coworker?state=muted' },
    { label: 'Coworker details, use only', href: '/lab-coworker?state=use' },
    { label: 'Coworker files', href: '/lab-coworker?screen=files' },
    { label: 'Coworker files, partial', href: '/lab-coworker?screen=files&state=to-connect' },
    { label: 'Coworker files, none', href: '/lab-coworker?screen=files&state=empty' },
    { label: 'Coworker files, loading', href: '/lab-coworker?screen=files&state=loading' },
    { label: 'Coworker apps', href: '/lab-coworker?screen=apps' },
    { label: 'Coworker apps, to connect', href: '/lab-coworker?screen=apps&state=to-connect' },
    { label: 'Coworker apps, loading', href: '/lab-coworker?screen=apps&state=loading' },
    { label: 'Coworker apps, use only', href: '/lab-coworker?screen=apps&state=use' },
    { label: 'Coworker routines', href: '/lab-coworker?screen=routines' },
    { label: 'Coworker routines, none', href: '/lab-coworker?screen=routines&state=empty' },
    { label: 'Coworker routines, loading', href: '/lab-coworker?screen=routines&state=loading' },
    { label: 'Coworker routines, use only', href: '/lab-coworker?screen=routines&state=use' },
    { label: 'Notifications', href: '/lab-notifications?state=normal' },
    { label: 'Notifications, loading', href: '/lab-notifications?state=loading' },
    { label: 'Notifications, push off', href: '/lab-notifications?state=push-off' },
    { label: 'Notifications, push never asked', href: '/lab-notifications?state=push-undetermined' },
    { label: 'Notifications, nothing', href: '/lab-notifications?state=nothing' },
    { label: 'Notifications, coworker rules', href: '/lab-notifications?state=rules' },
    { label: 'Coworker notifications', href: '/lab-notifications?screen=coworker&state=normal' },
    { label: 'Coworker notifications, muted', href: '/lab-notifications?screen=coworker&state=muted' },
    { label: 'Coworker notifications, no tasks', href: '/lab-notifications?screen=coworker&state=no-tasks' },
    { label: 'Coworker notifications, tasks failed', href: '/lab-notifications?screen=coworker&state=failed' },
    { label: 'AI providers, Rerun only', href: '/lab-providers?state=rerun-only' },
    { label: 'AI providers, full', href: '/lab-providers?state=full' },
    { label: 'AI providers, API keys only', href: '/lab-providers?state=keys' },
    { label: 'AI providers, to reconnect', href: '/lab-providers?state=reconnect' },
    { label: 'AI providers, credits used up', href: '/lab-providers?state=credit' },
    { label: 'AI providers, loading', href: '/lab-providers?state=loading' },
    { label: 'AI providers, member', href: '/lab-providers?state=full&role=member' },
    { label: 'AI providers, member, to reconnect', href: '/lab-providers?state=reconnect&role=member' },
    { label: 'AI providers, member, Rerun only', href: '/lab-providers?state=rerun-only&role=member' },
    { label: 'Add a provider', href: '/lab-providers?screen=add' },
    { label: 'Claude, start', href: '/lab-providers?screen=claude' },
    { label: 'Claude, code pasted', href: '/lab-providers?screen=claude&state=waiting' },
    { label: 'Claude, wrong code', href: '/lab-providers?screen=claude&state=error' },
    { label: 'Claude, connected', href: '/lab-providers?screen=claude&state=connected' },
    { label: 'Claude, sign in again', href: '/lab-providers?screen=claude&state=waiting&ending=reconnect' },
    { label: 'ChatGPT, start', href: '/lab-providers?screen=chatgpt' },
    { label: 'ChatGPT, code', href: '/lab-providers?screen=chatgpt&state=code' },
    { label: 'ChatGPT, stuck', href: '/lab-providers?screen=chatgpt&state=stuck' },
    { label: 'ChatGPT, code expired', href: '/lab-providers?screen=chatgpt&state=expired' },
    { label: 'ChatGPT, connected', href: '/lab-providers?screen=chatgpt&state=connected' },
    { label: 'API key, Anthropic', href: '/lab-providers?screen=key&provider=anthropic' },
    { label: 'API key, OpenRouter refused', href: '/lab-providers?screen=key&provider=openrouter&state=error' },
    { label: 'Provider, Claude', href: '/lab-providers?screen=detail&id=cnx-claude' },
    { label: 'Provider, Claude to sign in again', href: '/lab-providers?screen=detail&id=cnx-claude&state=reconnect' },
    { label: 'Provider, OpenRouter', href: '/lab-providers?screen=detail&id=cnx-openrouter' },
    { label: 'Provider, OpenRouter key rejected', href: '/lab-providers?screen=detail&id=cnx-openrouter&state=reconnect' },
    { label: 'Provider, OpenCode key rejected', href: '/lab-providers?screen=detail&id=cnx-opencode&state=reconnect' },
    { label: 'Provider, Rerun', href: '/lab-providers?screen=detail&id=rerun' },
    { label: 'Provider, Rerun credits used up', href: '/lab-providers?screen=detail&id=rerun&state=credit' },
    { label: 'Provider, OpenRouter, member', href: '/lab-providers?screen=detail&id=cnx-openrouter&role=member' },
    { label: 'Provider, OpenRouter key rejected, member', href: '/lab-providers?screen=detail&id=cnx-openrouter&state=reconnect&role=member' },
    { label: 'Add a provider, member', href: '/lab-providers?screen=add&role=member' },
    { label: 'Default model', href: '/lab-providers?screen=default' },
    { label: 'Default model, trial', href: '/lab-providers?screen=default&state=trial' },
    { label: 'Chat errors', href: '/lab-providers?screen=errors' },
]

const noop = () => {}
const byId = (id: string) => coworkers.find(coworker => coworker.id === id)!
const latestOf = (id: string) => sessions.find(session => session.coworkerId === id)

const LAB_QUESTION = { questions: [{ question: 'Which list should I start with?', options: ['Q4 prospects', 'Q1 renewals', 'Both'] }] }
const LAB_QUESTIONS = { questions: [{ question: 'Which channels should I post on?', options: ['LinkedIn', 'X', 'Instagram'], multiple: true }, { question: 'Anything I should not mention?', options: [] }] }
const LAB_LEADS = { kind: 'table' as const, scope: 'agent' as const, table: 'lyon_agencies', columns: ['name', 'city', 'stage', 'deal', 'next_call'], rows: [{ name: 'Mindblow', city: 'Lyon', stage: 'Won', deal: 12000, next_call: '2026-10-24' }, { name: 'Ciliabe', city: 'Villeurbanne', stage: 'Contacted', deal: 4500, next_call: '2026-10-28' }, { name: 'Lemon & Joy', city: 'Lyon', stage: 'New', deal: null, next_call: null }], total: 14, columnsTruncated: false, formats: { stage: 'tag', deal: 'currency:EUR', next_call: 'date' }, tones: { Won: 'green' as const } }
const LAB_FILES = { kind: 'file' as const, files: [{ path: 'out/lyon-agencies.csv', name: 'lyon-agencies.csv', size: 18_432, scope: 'agent' as const }, { path: 'out/proposal-mindblow.pdf', name: 'proposal-mindblow.pdf', size: 1_288_490, scope: 'agent' as const }] }
const LAB_SKILL_PROPOSAL: SkillProposal = { id: 'lab-skill', sessionId: 'lab', toolCallId: 'lab-skill-call', mode: 'create', slug: null, title: 'Deal follow-ups', summary: 'Short drafts, no discount.', instructions: ['Keep every follow-up under 90 words and never mention pricing unless the user asks for it.', 'Never offer a discount without an explicit go-ahead.'], status: 'proposed', appliedSlug: null, error: null, createdAt: '2026-10-26T09:00:00.000Z' }
const LAB_SKILL_STATES: SkillProposalStatus[] = ['proposed', 'accepted', 'applied', 'failed', 'dismissed']
const LAB_APPROVALS = { approvals: [{ action: 'Send the October newsletter to 1,240 subscribers', detail: 'subject: October at Acme\nlist: newsletter-main' }, { action: 'Delete 12 old drafts' }] }
const LAB_AT = new Date(Date.now() - 12 * 60000).toISOString()
const LAB_INBOX: InboxItem[] = [
    { id: 'i-ask', sessionId: 's1', sessionIds: ['s1'], agentId: 'agent-scout', agentName: 'Scout', status: 'awaiting_question', title: 'Q4 prospects', message: 'Which list should I start with?', updatedAt: LAB_AT, count: 1 },
    { id: 'i-ok', sessionId: 's2', sessionIds: ['s2'], agentId: 'agent-pulse', agentName: 'Pulse', status: 'awaiting_approval', title: 'LinkedIn post on pricing', message: null, updatedAt: LAB_AT, count: 1 },
    { id: 'i-ack', sessionId: 's3', sessionIds: ['s3'], agentId: 'agent-inbox', agentName: 'Inbox', status: 'awaiting_ack', title: 'Support triage', message: 'Three tickets mention the same billing bug, worth a look before Monday.', updatedAt: LAB_AT, count: 1 },
    { id: 'i-err', sessionId: 's4', sessionIds: ['s4'], agentId: 'agent-ledger', agentName: 'Ledger', status: 'error', title: 'Monthly close', message: 'The provider refused the request', updatedAt: LAB_AT, count: 1 },
    { id: 'i-done', sessionId: 's5', sessionIds: ['s5', 's6'], agentId: 'agent-recap', agentName: 'Recap', status: 'done', title: 'daily-digest', message: null, updatedAt: LAB_AT, count: 24 },
]
const blobLogo = (file: string) => `${environment.supabaseUrl}/storage/v1/object/public/blob-illustrations/${file}`
const LAB_WORKSPACES: WorkspaceSummary[] = [
    { id: 1, name: 'Acme Growth', iconUrl: blobLogo('green-energy-blob.webp'), plan: 'team', subscribed: true, role: 'admin' },
    { id: 2, name: 'Lemon & Joy', iconUrl: blobLogo('amber-torus-knot.webp'), plan: 'solo', subscribed: true, role: 'admin' },
    { id: 3, name: 'Northwind', iconUrl: null, plan: 'solo', subscribed: true, role: 'admin' },
    { id: 4, name: 'Broken logo', iconUrl: 'https://example.invalid/logo.png', plan: 'solo', subscribed: false, role: 'admin' },
]
const hitlProps = (toolCallId: string, input: Record<string, unknown>, kind: 'question' | 'approval' | 'secret' | 'takeover' = 'question', output?: unknown) => ({ pending: { kind, toolCallId, input, output }, agentId: 'agent-scout', coworkerName: 'Scout', webUrl: 'https://app.rerun.build', onAnswer: noop, onDismiss: noop })

// The microphone records for real; the upload and the transcription take a beat, then nothing is sent.
const LAB_VOICE: VoiceSender = {
    upload: () => new Promise(resolve => setTimeout(() => resolve('chat-uploads/lab-voice.m4a'), 1200)),
    transcribe: () => new Promise(resolve => setTimeout(() => resolve(MOCK_TRANSCRIPT), 1600)),
    send: async () => {},
}
const LAB_LIVE_START = Date.now()
const labLiveState = () => {
    const t = (Date.now() - LAB_LIVE_START) / 1000
    return { level: Math.max(0, 0.45 + 0.35 * Math.sin(t * 5.3) + 0.2 * Math.sin(t * 13.1)), durationMs: 7000 + ((Date.now() - LAB_LIVE_START) % 60000) }
}
const LAB_VOICE_MESSAGE = { transcript: MOCK_TRANSCRIPT, src: 'chat-uploads/lab-voice.m4a', durationMs: 12_480, peaks: MOCK_VOICE_PEAKS }

function LabRecorderRow({ status, error = null }: { status: 'starting' | 'recording' | 'processing' | 'failed'; error?: VoiceMessageError | null }) {
    return (
        <View style={{ gap: spacing.sm }}>
            <VoiceRecorderBar status={status} error={error} getLiveState={labLiveState} />
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <RoundButton symbol="xmark" label="Discard recording" tone="plain" disabled={status === 'processing'} onPress={noop} />
                <View style={{ flex: 1 }} />
                {status === 'failed' ? <RoundButton symbol="arrow.clockwise" label="Retry" tone="primary" onPress={noop} /> : <RoundButton symbol="arrow.up" label="Send" tone="primary" busy={status !== 'recording'} onPress={noop} />}
            </View>
        </View>
    )
}

function Voice({ scheme }: { scheme: ColorScheme }) {
    return (
        <ThemeScope scheme={scheme}>
            <View style={{ gap: spacing.lg, padding: spacing.md, borderRadius: radius.lg, backgroundColor: palette[scheme].background, borderWidth: 1, borderColor: palette[scheme].border }}>
                <LabRecorderRow status="recording" />
                <LabRecorderRow status="processing" />
                <LabRecorderRow status="starting" />
                <LabRecorderRow status="failed" error="silent" />
                <VoiceUserMessage voice={LAB_VOICE_MESSAGE} owner={null} defaultTranscriptOpen />
                <VoiceUserMessage voice={{ ...LAB_VOICE_MESSAGE, durationMs: 3_200, peaks: [], transcript: 'Perfect, send them.' }} owner={null} media={[{ url: blobLogo('green-energy-blob.webp'), name: 'Photo', image: true }]} />
                <VoiceUserMessage voice={{ ...LAB_VOICE_MESSAGE, src: 'chat-uploads/from-chrome-voice.webm', durationMs: 64_000, transcript: '' }} owner={null} />
                <Composer value="" onChangeText={noop} onSend={noop} onStop={noop} running={false} placeholder="Message Pulse" voice={LAB_VOICE} />
            </View>
        </ThemeScope>
    )
}

function Pieces({ scheme }: { scheme: ColorScheme }) {
    return (
        <ThemeScope scheme={scheme}>
            <View style={{ paddingVertical: spacing.md, gap: spacing.lg, borderRadius: radius.lg, backgroundColor: palette[scheme].background, borderWidth: 1, borderColor: palette[scheme].border, overflow: 'hidden' }}>
                <View>
                    <SectionHeader label="Needs you" count={2} collapsed={false} onToggle={noop} />
                    {['agent-scout', 'agent-ledger', 'agent-pulse', 'agent-inbox', 'agent-recap'].map(id => (
                        <CoworkerRow key={id} coworker={byId(id)} line={statusLine(byId(id), latestOf(id))} minutesAgo={byId(id).updatedMinutesAgo} unread={byId(id).unread} onPress={noop} />
                    ))}
                    <SectionHeader label="Coworkers" count={3} collapsed onToggle={noop} divided />
                </View>
                <View style={{ flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg }}>
                    <LabChip coworker={byId('agent-pulse')} session={{ id: 'pulse-1', title: 'LinkedIn post on pricing', running: true, empty: false }} active />
                    <LabChip coworker={byId('agent-scout')} session={{ id: 'lab-new', title: null, running: false, empty: true }} active={false} />
                </View>
                <View style={{ gap: spacing.sm, paddingHorizontal: spacing.xl }}>
                    <RunStatus coworker={byId('agent-recap')} phase="waking" />
                    <RunStatus coworker={byId('foreman')} phase="thinking" />
                    <RunStatus coworker={byId('agent-pulse')} phase="working" />
                </View>
                <View style={{ gap: spacing.sm, paddingHorizontal: spacing.md }}>
                    <LabComposer placeholder="Ask Rerun anything" />
                    <LabComposer placeholder="Message Pulse" running />
                    <LabComposer placeholder="Message Pulse" value="Make it weekly instead" />
                    <LabComposer placeholder="Message Pulse" value="And add the Q1 renewals" running />
                    <LabComposer placeholder="What should we work on?" value="Find 10 agencies in Lyon that might need a booking tool." target />
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg }}>
                    <ModelChip model={findModel('claude-opus-5-5')} onPress={noop} />
                </View>
            </View>
        </ThemeScope>
    )
}

function LabComposer({ placeholder, value = '', running = false, target }: { placeholder: string; value?: string; running?: boolean; target?: boolean }) {
    return <Composer value={value} onChangeText={noop} onSend={noop} onStop={noop} running={running} placeholder={placeholder} model={findModel('rerun-max')} onOpenModel={noop} target={target ? { coworker: byId('foreman'), choices: coworkers, onPick: noop } : undefined} />
}

const VARIANTS: ButtonVariant[] = ['default', 'outline', 'secondary', 'ghost', 'destructive']
const TONES: BadgeTone[] = ['brand', 'green', 'red', 'orange', 'yellow', 'cyan', 'neutral']

function Controls({ scheme }: { scheme: ColorScheme }) {
    return (
        <ThemeScope scheme={scheme}>
            <View style={{ gap: spacing.lg, padding: spacing.md, borderRadius: radius.lg, backgroundColor: palette[scheme].background, borderWidth: 1, borderColor: palette[scheme].border }}>
                {VARIANTS.map(variant => (
                    <View key={variant} style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm }}>
                        <Button label="Approve" variant={variant} onPress={noop} />
                        <Button label="Edit" variant={variant} size="sm" symbol="pencil" onPress={noop} />
                        <Button label="Add" variant={variant} symbol="plus" iconOnly onPress={noop} />
                    </View>
                ))}
                <View style={{ gap: spacing.sm }}>
                    <Button label="New chat" symbol="plus" size="lg" onPress={noop} />
                    <Button label="Continue with email" variant="outline" size="lg" symbol="envelope" onPress={noop} />
                    <Button label="Sending" size="lg" loading onPress={noop} />
                    <Button label="Disabled" size="lg" disabled onPress={noop} />
                    <Button label="Disabled" variant="outline" size="lg" disabled onPress={noop} />
                </View>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                    <Chip label="Find leads in Lyon" onPress={noop} />
                    <Chip label="Weekly recap" onPress={noop} />
                    <Chip label="Selected" selected onPress={noop} />
                </View>
                <View style={{ gap: spacing.md }}>
                    <TextField id="lab-name" label="Name" value="" placeholder="Scout" onChangeText={noop} />
                    <TextField id="lab-key" label="API key" value="sk-live-42" onChangeText={noop} verbatim />
                </View>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                    {TONES.map(tone => (
                        <Badge key={tone} label={tone} tone={tone} />
                    ))}
                    {TONES.map(tone => (
                        <Badge key={`xs-${tone}`} label={tone} tone={tone} size="xs" />
                    ))}
                </View>
            </View>
        </ThemeScope>
    )
}

function LabChip({ coworker, session, active }: { coworker: Coworker; session: ChatTab; active: boolean }) {
    return (
        <GlassView style={{ borderRadius: GLASS_BUTTON_SIZE / 2, overflow: 'hidden' }}>
            <ChipPage coworker={coworker} session={session} active={active} width={170} />
        </GlassView>
    )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
    return (
        <View style={{ gap: spacing.sm }}>
            <AppText variant="footnote" tone="muted" medium>
                {title}
            </AppText>
            {children}
        </View>
    )
}

function Panel({ scheme }: { scheme: ColorScheme }) {
    return (
        <ThemeScope scheme={scheme}>
            <View style={{ flex: 1, padding: spacing.md, gap: spacing.md, borderRadius: radius.lg, backgroundColor: palette[scheme].background, borderWidth: 1, borderColor: palette[scheme].border }}>
                {BUDDY_MOODS.map(mood => (
                    <View key={mood} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                        {SIZES.map(size => (
                            <AgentBuddy key={size} agentId="agent-inbox" mood={mood} size={size} />
                        ))}
                    </View>
                ))}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm }}>
                    <ForemanOrb size={20} />
                    <ForemanOrb size={40} />
                    <ForemanOrb size={56} />
                    <ForemanOrb size={56} state="thinking" />
                </View>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                    {SAMPLE_IDS.map(id => (
                        <AgentBuddy key={id} agentId={id} size={40} animated={false} />
                    ))}
                </View>
            </View>
        </ThemeScope>
    )
}

export default function Lab() {
    const theme = useTheme()
    const insets = useSafeAreaInsets()
    return (
        <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={{ paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.xl, paddingHorizontal: spacing.lg, gap: spacing.xl }}>
            <AppText variant="largeTitle">Lab</AppText>
            <Group title="Controls, light">
                <Controls scheme="light" />
            </Group>
            <Group title="Controls, dark">
                <Controls scheme="dark" />
            </Group>
            <Group title="Workspace picker: a logo, no logo, a broken logo">
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                    {LAB_WORKSPACES.map(workspace => (
                        <WorkspaceMenuView key={workspace.id} current={workspace} workspaces={LAB_WORKSPACES} onSwitch={noop} />
                    ))}
                </View>
            </Group>
            <Group title="Voice: recording, sending, starting, failed, then the bubble (peaks, none, a WebM from Chrome)">
                <Voice scheme="light" />
                <Voice scheme="dark" />
            </Group>
            <Group title="Buddies and the Foreman, light and dark">
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                    <Panel scheme="light" />
                    <Panel scheme="dark" />
                </View>
            </Group>
            <Group title="Home rows, tabs, run status, composer, light">
                <Pieces scheme="light" />
            </Group>
            <Group title="Same, dark">
                <Pieces scheme="dark" />
            </Group>
            <Group title="Notifications: the bell at 0, 3 and 120, and a row of each status">
                <View style={{ gap: spacing.sm }}>
                    {(['light', 'dark'] as const).map(scheme => (
                        <ThemeScope key={scheme} scheme={scheme}>
                            <View style={{ gap: spacing.md, paddingVertical: spacing.md, borderRadius: radius.lg, backgroundColor: palette[scheme].background, borderWidth: 1, borderColor: palette[scheme].border, overflow: 'hidden' }}>
                                <View style={{ flexDirection: 'row', gap: spacing.lg, paddingHorizontal: spacing.lg, paddingTop: spacing.xs }}>
                                    {[0, 3, 120].map(count => (
                                        <InboxButton key={count} count={count} onPress={noop} />
                                    ))}
                                </View>
                                {LAB_INBOX.map(item => (
                                    <InboxRow key={item.id} item={item} onOpen={noop} onMarkRead={noop} rule={{ mode: "default", follow: true }} onRule={noop} onSettings={noop} />
                                ))}
                            </View>
                        </ThemeScope>
                    ))}
                </View>
            </Group>
            <Group title="Sign in, light and dark">
                <View style={{ gap: spacing.sm }}>
                    {(['light', 'dark'] as const).map(scheme => (
                        <ThemeScope key={scheme} scheme={scheme}>
                            <View style={{ gap: spacing.sm, padding: spacing.md, borderRadius: radius.lg, backgroundColor: palette[scheme].background, borderWidth: 1, borderColor: palette[scheme].border }}>
                                <PhoneField country="FR" value="" onChangeText={noop} onPickCountry={noop} />
                                <PhoneField country="FR" value="06 12 34 56 78" onChangeText={noop} onPickCountry={noop} invalid />
                                <PillButton label="Send by WhatsApp" onPress={noop} />
                                <PillButton label="Send by SMS" variant="secondary" onPress={noop} />
                                <PillButton label="Continue" loading onPress={noop} />
                                <CodeField length={6} value="12" onChangeText={noop} onComplete={noop} disabled />
                                <CodeField length={6} value="123456" onChangeText={noop} onComplete={noop} disabled invalid />
                            </View>
                        </ThemeScope>
                    ))}
                </View>
            </Group>
            <Group title="Conversation loading: the thread, an unnamed tab">
                <View style={{ gap: spacing.sm }}>
                    {(['light', 'dark'] as const).map(scheme => (
                        <ThemeScope key={scheme} scheme={scheme}>
                            <View style={{ gap: spacing.xl, padding: spacing.md, borderRadius: radius.lg, backgroundColor: palette[scheme].background, borderWidth: 1, borderColor: palette[scheme].border }}>
                                <ConversationSkeleton />
                                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                                    <LabChip coworker={byId('agent-pulse')} session={{ id: 'pulse-loading', title: null, running: false, empty: false, loading: true }} active />
                                    <LabChip coworker={byId('agent-pulse')} session={{ id: 'pulse-loaded', title: 'LinkedIn post on pricing', running: false, empty: false }} active={false} />
                                </View>
                            </View>
                        </ThemeScope>
                    ))}
                </View>
            </Group>
            <Group title="Questions: one choice, several choices over two steps, and their receipts">
                <View style={{ gap: spacing.sm }}>
                    {(['light', 'dark'] as const).map(scheme => (
                        <ThemeScope key={scheme} scheme={scheme}>
                            <View style={{ gap: spacing.md, padding: spacing.md, borderRadius: radius.lg, backgroundColor: palette[scheme].background, borderWidth: 1, borderColor: palette[scheme].border }}>
                                <HitlBlock {...hitlProps('lab-q1', LAB_QUESTION)} />
                                <HitlBlock {...hitlProps('lab-q2', LAB_QUESTIONS)} />
                                <QuestionReceipt answers={[{ question: 'Which channels should I post on?', answers: ['LinkedIn', 'X'] }, { question: 'Anything I should not mention?', answers: [] }]} />
                                <CancelledReceipt of="question" />
                            </View>
                        </ThemeScope>
                    ))}
                </View>
            </Group>
            <Group title="Cards: tables, files, notification to read, events, sources">
                <View style={{ gap: spacing.sm }}>
                    {(['light', 'dark'] as const).map(scheme => (
                        <ThemeScope key={scheme} scheme={scheme}>
                            <View style={{ gap: spacing.md, padding: spacing.md, borderRadius: radius.lg, backgroundColor: palette[scheme].background, borderWidth: 1, borderColor: palette[scheme].border }}>
                                <TableCardView card={{ ...LAB_LEADS, layout: 'list', fields: { title: 'name', subtitle: 'city', badge: 'stage', value: 'deal' } }} agentId="agent-scout" />
                                <TableCardView card={LAB_LEADS} agentId="agent-scout" />
                                <FileCardView card={LAB_FILES} agentId="agent-scout" />
                                <AlertWidget message="The **Q4 report** is ready in your shared folder." onAcknowledge={async () => {}} />
                                <EventCardView card={{ kind: 'notification', message: 'The Q4 report is ready in your shared folder.' }} coworkerName="Scout" />
                                <EventCardView card={{ kind: 'setup', summary: 'I post a digest of new leads every morning at 8.', schedules: 1, triggers: 2 }} coworkerName="Scout" />
                                <EventCardView card={{ kind: 'brain-proposal', title: 'Pricing', mode: 'edit' }} coworkerName="Scout" />
                                <EventCardView card={{ kind: 'brain-change', change: { status: 'saved', slug: 'icp', title: 'Ideal customer', mode: 'create' } }} coworkerName="Scout" />
                                {LAB_SKILL_STATES.map(status => (
                                    <SkillProposalRow key={status} proposal={{ ...LAB_SKILL_PROPOSAL, id: status, status, error: status === 'failed' ? 'The model timed out while writing the skill.' : null }} pending={false} onDecide={() => {}} />
                                ))}
                                <PinnedSkillProposal proposal={LAB_SKILL_PROPOSAL} pending={false} onDecide={() => {}} />
                                <Sources sources={[{ url: 'https://www.lyon-france.com/agences', title: 'Agencies in Lyon' }, { url: 'https://example.com/report' }]} />
                            </View>
                        </ThemeScope>
                    ))}
                </View>
            </Group>
            <Group title="Approvals, takeover, and their receipts">
                <View style={{ gap: spacing.sm }}>
                    {(['light', 'dark'] as const).map(scheme => (
                        <ThemeScope key={scheme} scheme={scheme}>
                            <View style={{ gap: spacing.md, padding: spacing.md, borderRadius: radius.lg, backgroundColor: palette[scheme].background, borderWidth: 1, borderColor: palette[scheme].border }}>
                                <HitlBlock {...hitlProps('lab-a1', LAB_APPROVALS, 'approval')} />
                                <HitlBlock {...hitlProps('lab-t1', { url: 'https://accounts.google.com/signin', reason: 'Sign in to Google so I can read the shared sheet.' }, 'takeover')} />
                                <ApprovalReceipt decisions={[{ action: 'Send the October newsletter to 1,240 subscribers', decision: 'approved' }, { action: 'Delete 12 old drafts', decision: 'declined', note: 'Keep them for now' }]} />
                            </View>
                        </ThemeScope>
                    ))}
                </View>
            </Group>
            <Group title="HITL the app cannot draw: a newer version, a tool it cannot name">
                <View style={{ gap: spacing.sm }}>
                    {(['light', 'dark'] as const).map(scheme => (
                        <ThemeScope key={scheme} scheme={scheme}>
                            <View style={{ gap: spacing.md, padding: spacing.md, borderRadius: radius.lg, backgroundColor: palette[scheme].background, borderWidth: 1, borderColor: palette[scheme].border }}>
                                <HitlBlock {...hitlProps('lab-1', { ...LAB_QUESTION, v: 9 })} />
                                <UnknownCallBlock call={{ toolCallId: 'lab-2', toolName: 'request_signature', input: { reason: 'Sign the NDA with Acme before I send the proposal.' } }} coworkerName="Scout" webUrl="https://app.rerun.build" />
                            </View>
                        </ThemeScope>
                    ))}
                </View>
            </Group>
            <Group title="Update required, light and dark">
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                    {(['light', 'dark'] as const).map(scheme => (
                        <ThemeScope key={scheme} scheme={scheme}>
                            <View style={{ flex: 1, height: 320, borderRadius: radius.lg, borderWidth: 1, borderColor: palette[scheme].border, overflow: 'hidden' }}>
                                <UpdateRequired />
                            </View>
                        </ThemeScope>
                    ))}
                </View>
            </Group>
            <View style={{ gap: spacing.xs }}>
                <AppText variant="footnote" tone="muted" medium>
                    Screens
                </AppText>
                {SCREENS.map(screen => (
                    <Link key={screen.label} href={screen.href} style={{ paddingVertical: spacing.md }}>
                        <AppText variant="body">{screen.label}</AppText>
                    </Link>
                ))}
            </View>
        </ScrollView>
    )
}
