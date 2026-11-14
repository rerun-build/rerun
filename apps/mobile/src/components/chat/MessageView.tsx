import { hitlKindOf, isSubRunLive, pairSubRuns, parseHitlReply, parseInstallMessage, parseScheduledRun, parseTriggerPayload, QUICK_REPLIES_TOOL, isToolPart, messageText, skillProposalIdOf, SUB_RUN_TOOL_NAMES, toolActivityOf, toolLabelOf, toolNameOf, type ConversationMessageMetadata, type MessageFeedbackRating, type PaidTurnSources, type TriggerPayload } from '@rerun/contracts'
import type { UIMessage } from 'ai'
import { View } from 'react-native'
import { useTranslations } from 'use-intl'

import { ownedFileUrl, type FileOwner } from '@/api/files'
import type { MessageFeedback } from '@/chat/useMessageFeedback'
import type { SkillProposals } from '@/chat/useSkillProposals'
import type { ViewerItem } from '@/components/viewer/viewer-store'
import { spacing } from '@/theme/tokens'

import { AgentPickerCard, readAgentPicks } from './cards/AgentPickerCard'
import { cardOf, connectCardOf, eventCardOf } from './cards/cards'
import { ConnectCardView } from './cards/ConnectCards'
import { EventCardView } from './cards/EventCardView'
import { SkillProposalRow } from './cards/SkillProposalRow'
import { Sources, type Source } from './cards/Sources'
import { FileCardView } from './cards/FileCardView'
import { TableCardView } from './cards/TableCardView'
import { ApprovalReceipt, CancelledReceipt, McpReceipt, QuestionReceipt, SecretReceipt, ServiceReceipt, SpendReceipt, TakeoverReceipt } from './hitl/Receipts'
import { attachmentsOf, userTextOf, voiceOf } from './message-text'
import { InstallDivider, ScheduledRunDivider, WebhookRunDivider } from './origins/RunOrigins'
import { AssistantMessage, UserBubble } from './Messages'
import { MessageTimeReveal, type MessageStamp } from './MessageTimeReveal'
import { PaidSourcesPill } from './PaidSourcesPill'
import { CompactionStep, ReasoningStep, StepGroup, toolStatusOf, ToolCallStep, type CompactionData, type StepItem } from './steps/StepGroup'
import { SubRunBlock, subRunStatus } from './steps/SubRunBlock'
import { toolSymbolOf } from './steps/toolSymbols'
import { VoiceUserMessage } from './VoiceUserMessage'

type ToolPart = { type: string; toolName?: string; toolCallId?: string; state?: string; errorText?: string; input?: unknown; inputText?: string; output?: unknown }

const FOREMAN_SHORTCUTS = new Set(['show_agents', 'open_connector_setup'])

function isStep(part: ToolPart): boolean {
    const name = toolNameOf(part)
    if (name === QUICK_REPLIES_TOOL) return false
    return !hitlKindOf(name) || part.state === 'output-error'
}

type Origin = { kind: 'install'; agentName: string; guide: string } | { kind: 'scheduled'; name: string; prompt: string } | { kind: 'webhook'; payload: TriggerPayload }

function originOf(message: UIMessage): Origin | null {
    const metadata = message.metadata as ConversationMessageMetadata | undefined
    const text = messageText(message)
    if (metadata?.install) return { kind: 'install', agentName: metadata.install.agentName, guide: text }
    if (metadata?.scheduledRun) return { kind: 'scheduled', name: metadata.scheduledRun.name, prompt: text }
    const install = parseInstallMessage(text)
    if (install) return { kind: 'install', ...install }
    const scheduled = parseScheduledRun(text)
    if (scheduled) return { kind: 'scheduled', ...scheduled }
    const payload = parseTriggerPayload(text)
    return payload ? { kind: 'webhook', payload } : null
}

type MessageViewProps = {
    message: UIMessage
    isLastAssistant: boolean
    running: boolean
    agentId: string | null
    fileOwner: FileOwner | null
    coworkerName: string
    hiddenCallId: string | null
    skillProposals?: SkillProposals
    onStopTask?: (taskId: string) => void
    onRegenerate?: () => void
    feedback?: MessageFeedback
    stamp?: MessageStamp
    paidSources?: PaidTurnSources
}

type Block = { key: string; node: React.ReactNode }

export function MessageView({ message, isLastAssistant, running, agentId, fileOwner, coworkerName, hiddenCallId, skillProposals, onStopTask, onRegenerate, feedback, stamp, paidSources }: MessageViewProps) {
    const t = useTranslations('mobileChat.messages')
    const tTools = useTranslations('tools')
    if (message.role === 'user') {
        const origin = originOf(message)
        if (origin?.kind === 'install') return <InstallDivider agentName={origin.agentName} guide={origin.guide} installing={running} owner={fileOwner} />
        if (origin?.kind === 'scheduled') return <ScheduledRunDivider run={origin} owner={fileOwner} />
        if (origin?.kind === 'webhook') return <WebhookRunDivider payload={origin.payload} owner={fileOwner} />
        const text = userTextOf(message)
        const reply = parseHitlReply(text)
        if (reply?.kind === 'question') return <QuestionReceipt answers={reply.answers} />
        if (reply?.kind === 'approval') return <ApprovalReceipt decisions={reply.decisions} />
        if (reply?.kind === 'service') return <ServiceReceipt entries={reply.entries} />
        if (reply?.kind === 'secret') return <SecretReceipt entries={reply.entries} />
        if (reply?.kind === 'mcp') return <McpReceipt name={reply.name} />
        if (reply?.kind === 'takeover') return <TakeoverReceipt url={reply.url} />
        if (reply?.kind === 'spend') return <SpendReceipt decision={reply} />
        if (reply?.kind === 'cancelled') return <CancelledReceipt of={reply.of} />
        const local = message.parts.flatMap(part => (part.type === 'file' ? [{ url: part.url, name: part.filename ?? t('photo'), image: part.mediaType.startsWith('image/') }] : []))
        const stored = fileOwner ? attachmentsOf(message).map(({ name, path }) => ({ url: ownedFileUrl(fileOwner, path), name })) : []
        const media: ViewerItem[] = local.length > 0 ? local : stored
        const voice = voiceOf(message)
        if (voice) return <VoiceUserMessage voice={voice} owner={fileOwner} media={media.length ? media : undefined} stamp={stamp} />
        if (!text && media.length === 0) return null
        return <UserBubble text={text} media={media.length ? media : undefined} owner={fileOwner} stamp={stamp} />
    }

    const blocks: Block[] = []
    let buffer = ''
    let steps: StepItem[] = []
    let underText: Block[] = []
    const lastPart = message.parts.length - 1
    const subRuns = pairSubRuns(message.parts as { type: string; id?: string; toolCallId?: string; toolName?: string; data?: unknown }[])
    const flushText = (key: string) => {
        if (!buffer.trim()) return
        blocks.push({ key, node: <AssistantMessage text={buffer} showActions={false} owner={fileOwner} /> })
        buffer = ''
        blocks.push(...underText)
        underText = []
    }
    let lastGroupAt = -1
    let lastGroupItems: StepItem[] = []
    const flushSteps = () => {
        if (steps.length > 0) {
            lastGroupAt = blocks.length
            lastGroupItems = steps
            blocks.push({ key: `g${steps[0].key}`, node: <StepGroup items={steps} agentId={null} /> })
        }
        steps = []
    }
    const addStep = (step: StepItem, index: number) => {
        flushText(`t${index}`)
        steps.push(step)
    }
    const addBlock = (block: Block, index: number) => {
        flushText(`t${index}`)
        flushSteps()
        blocks.push(block)
    }
    message.parts.forEach((part, index) => {
        if (part.type === 'text') {
            flushSteps()
            buffer += (part as { text: string }).text
            return
        }
        if (part.type === 'reasoning') {
            const text = (part as { text: string }).text.trim()
            const streaming = isLastAssistant && running && index === lastPart
            if (!text && !streaming) return
            addStep({ key: `r${index}`, symbol: 'brain', status: streaming ? 'running' : 'done', runningLabel: t('thinking'), node: <ReasoningStep text={text} streaming={streaming} /> }, index)
            return
        }
        if (part.type === 'data-delegate' || part.type === 'data-call-agent') {
            const orphan = subRuns.orphans.get((part as { id?: string }).id ?? '')
            if (!orphan) return
            const toolName = SUB_RUN_TOOL_NAMES[orphan.kind]
            const live = orphan.tasks.some(isSubRunLive)
            const node = <SubRunBlock toolName={toolName} state={live ? 'input-available' : 'output-available'} progress={orphan} onStopTask={onStopTask} />
            if (live) addBlock({ key: `d${index}`, node }, index)
            else addStep({ key: `d${index}`, symbol: toolSymbolOf(toolName), status: 'done', node }, index)
            return
        }
        if (part.type === 'data-compaction') {
            const data = (part as unknown as { data: CompactionData }).data
            addStep({ key: `k${index}`, symbol: 'minimize', status: data.status, runningLabel: t('compacting'), node: <CompactionStep data={data} /> }, index)
            return
        }
        if (!isToolPart(part)) return
        if (part.toolCallId === hiddenCallId && hiddenCallId) return
        const toolName = toolNameOf(part)
        if (toolName === 'skill_propose') {
            const proposalId = skillProposalIdOf(part.output)
            const proposal = proposalId && !skillProposals?.pinnedIds.has(proposalId) ? skillProposals?.proposals.get(proposalId) : undefined
            if (proposal && skillProposals) addBlock({ key: `k${index}`, node: <SkillProposalRow proposal={proposal} pending={skillProposals.pendingId === proposal.id} onDecide={skillProposals.decide} /> }, index)
            return
        }
        const event = eventCardOf(part)
        if (event) {
            addBlock({ key: `e${index}`, node: <EventCardView card={event} coworkerName={coworkerName} /> }, index)
            return
        }
        const connect = agentId ? connectCardOf(part) : null
        if (connect && agentId) {
            addBlock({ key: `n${index}`, node: <ConnectCardView card={connect} agentId={agentId} /> }, index)
            return
        }
        const card = agentId ? cardOf(part) : null
        if (card && agentId) {
            addBlock({ key: `c${index}`, node: card.kind === 'table' ? <TableCardView card={card.card} agentId={agentId} /> : <FileCardView card={card.card} agentId={agentId} /> }, index)
            return
        }
        if (!agentId && FOREMAN_SHORTCUTS.has(toolName) && part.state !== 'output-error') {
            underText.push({ key: `p${index}`, node: <AgentPickerCard picks={readAgentPicks(toolName, part.input)} /> })
            return
        }
        if (!isStep(part)) return
        const progress = part.toolCallId ? subRuns.byToolCallId.get(part.toolCallId) : undefined
        if (progress) {
            const status = subRunStatus(progress, part.state)
            const node = <SubRunBlock toolName={toolName} state={part.state} errorText={part.errorText} progress={progress} onStopTask={onStopTask} />
            if (status === 'running') addBlock({ key: part.toolCallId ?? `s${index}`, node }, index)
            else addStep({ key: part.toolCallId ?? `s${index}`, symbol: toolSymbolOf(toolName), status, node }, index)
            return
        }
        addStep({ key: part.toolCallId ?? `s${index}`, symbol: toolSymbolOf(toolName), status: toolStatusOf(part.state), runningLabel: toolActivityOf(toolName, part.input, tTools) ?? t('runningTool', { tool: toolLabelOf(toolName, part.input, tTools) }), node: <ToolCallStep toolName={toolName} state={part.state} input={part.input} inputText={part.inputText} output={part.output} errorText={part.errorText} /> }, index)
    })
    flushSteps()
    if (isLastAssistant && lastGroupAt >= 0) blocks[lastGroupAt] = { ...blocks[lastGroupAt], node: <StepGroup items={lastGroupItems} agentId={agentId} /> }
    const closing = buffer
    buffer = ''
    const held = underText
    const sources = message.parts.filter(part => part.type === 'source-url').map(part => ({ url: (part as Source).url, title: (part as Source).title }))

    const answer = messageText(message)
    const actions = { onRegenerate, rating: feedback?.ratingOf(message.id) ?? null, onRate: feedback ? (rating: MessageFeedbackRating) => void feedback.rate(message.id, rating, answer) : undefined }
    if (closing.trim().length > 0) blocks.push({ key: 'closing', node: <AssistantMessage text={closing} showActions={isLastAssistant && !running} streaming={isLastAssistant && running} owner={fileOwner} actions={actions} /> })
    blocks.push(...held)
    if (sources.length > 0) blocks.push({ key: 'sources', node: <Sources sources={sources} /> })
    if (paidSources && !(isLastAssistant && running)) blocks.push({ key: 'paid-sources', node: <PaidSourcesPill turn={paidSources} /> })
    if (blocks.length === 0) return null

    return (
        <MessageTimeReveal stamp={stamp} side="left">
            <View style={{ gap: spacing.md }}>
                {blocks.map(block => (
                    <View key={block.key}>{block.node}</View>
                ))}
            </View>
        </MessageTimeReveal>
    )
}
