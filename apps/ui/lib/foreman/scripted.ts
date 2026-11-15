import 'server-only'

import { createIdGenerator, type UIMessage, type UIMessageStreamWriter } from 'ai'

import type { WorkspaceContext } from '@/app/api/_auth/ownership'
import type { SubRunTask } from '@/lib/chat/sub-run-progress'
import { buildTeamOnce } from './build-once'
import { isKickoffText, readOwnAsk } from './kickoff-marker'
import { writePlan, type WrittenPlan } from './onboarding-tools'
import { foremanPhase, isNamedReadyMade, type ForemanPhase, type ForemanState } from './phase'
import { pinnedPlanBoxes, planKinds } from './phases'
import { lastShownPlan, planRevisionAsk, templateCardPlan } from './shown-plan'
import { readStarterPackAnswer, SHOW_STARTER_PACK_TOOL, starterPackPlan, type StarterPackInput } from './starter-pack'
import { loadStarterPack, nameCustomCoworker } from './starter-pack-offer'
import { owedTemplatePurchase, type OwedTemplatePurchase } from './template-purchase'

export const OPEN_CHECKOUT_TOOL = 'open_checkout'
export const BUILD_TEAM_TOOL = 'build_team'
export const OPEN_TEMPLATE_PURCHASE_TOOL = 'open_template_purchase'

export type ScriptedIntent = 'confirm_plan' | 'offer_trial' | 'build'

export type ForemanScript =
    | { kind: 'offer_pack'; pack: StarterPackInput }
    | { kind: 'offer_trial'; template?: TemplateCard }
    | { kind: 'offer_purchase'; purchase: OwedTemplatePurchase; template?: TemplateCard }
    | { kind: 'build'; state: ForemanState; template?: TemplateCard }

type TemplateCard = { templates: { slug: string; title: string; why: string }[]; box?: string; boxes: { name: string }[] }

const SHOW_TEMPLATES_TOOL = 'show_templates'

type LoosePart = { type: string; state?: string; input?: unknown; output?: unknown; text?: string }

const TOOL_CALL_ID = createIdGenerator({ prefix: 'call', size: 16 })

function lastToolPart(message: UIMessage): LoosePart | null {
    const parts = message.parts as LoosePart[]
    for (let index = parts.length - 1; index >= 0; index--) {
        if (parts[index].type.startsWith('tool-')) return parts[index]
    }
    return null
}

function confirmedPlanCard(message: UIMessage): boolean {
    const tool = lastToolPart(message)
    if (tool?.type !== 'tool-show_plan' || tool.state !== 'output-available') return false
    const output = tool.output as { answered?: unknown; confirmed?: unknown } | null
    return output?.answered === true && output.confirmed === true
}

function chosenTemplatePlan(message: UIMessage): ReturnType<typeof templateCardPlan> {
    const tool = lastToolPart(message)
    if (tool?.type !== 'tool-show_templates' || tool.state !== 'output-available') return null
    const chosen = (tool.output as { chosen?: unknown } | null)?.chosen
    return typeof chosen === 'string' && chosen ? templateCardPlan(tool.input, chosen) : null
}

type ArrivedPlan = { shown: { items: unknown[]; boxes: { name: string }[] }; template?: TemplateCard }

function arrivedReadyMadePlan(state: ForemanState, messages: UIMessage[]): ArrivedPlan | null {
    const last = messages.at(-1)
    const intent = state.intent
    if (state.phase !== 'plan' || !intent || !isNamedReadyMade(intent) || !last || !isKickoff(last)) return null
    const pinned = pinnedPlanBoxes(state)
    const boxes = pinned.map(name => ({ name }))
    if (intent.kind === 'share') return { shown: { items: [{ kind: 'share', token: intent.token, name: intent.title, box: pinned[0] }], boxes } }
    if (intent.kind !== 'template' || !intent.title) return null
    const template: TemplateCard = { templates: [{ slug: intent.slug, title: intent.title, why: '' }], box: pinned[0], boxes }
    const shown = templateCardPlan(template)
    return shown ? { shown, template } : null
}

type StarterPackStep = { kind: 'offer' } | { kind: 'picked'; input: unknown; chosen: string[] } | { kind: 'custom'; asked: string }

function lastStarterPackPart(messages: UIMessage[]): LoosePart | null {
    for (let index = messages.length - 1; index >= 0; index--) {
        const message = messages[index]
        if (message.role !== 'assistant') continue
        const tool = lastToolPart(message)
        if (tool) return tool.type === `tool-${SHOW_STARTER_PACK_TOOL}` ? tool : null
    }
    return null
}

function typedText(message: UIMessage): string {
    return (message.parts as LoosePart[])
        .flatMap(part => (part.type === 'text' && typeof part.text === 'string' ? [part.text] : []))
        .join('\n')
        .trim()
}

function starterPackStep(state: ForemanState, messages: UIMessage[]): StarterPackStep | null {
    const last = messages.at(-1)
    if (state.phase !== 'plan' || state.intent || !last) return null
    if (isKickoff(last)) {
        const asked = readOwnAsk(typedText(last))
        return asked ? { kind: 'custom', asked } : { kind: 'offer' }
    }

    const card = lastStarterPackPart(messages)
    if (!card || card.state !== 'output-available') return null
    if (last.role === 'user') {
        const asked = typedText(last)
        return asked ? { kind: 'custom', asked } : null
    }
    const answer = readStarterPackAnswer(card.output)
    if (!answer?.answered) return { kind: 'offer' }
    return 'custom' in answer ? { kind: 'custom', asked: answer.custom } : { kind: 'picked', input: card.input, chosen: answer.chosen }
}

async function writeStarterPlan(ctx: WorkspaceContext, state: ForemanState, step: Exclude<StarterPackStep, { kind: 'offer' }>): Promise<WrittenPlan> {
    const title = state.answers.company_name ?? state.workspaceName
    if (step.kind === 'picked') return writePlan(ctx, { ...starterPackPlan(step.input, step.chosen), title }, ['template'])
    const pinned = pinnedPlanBoxes(state)
    const { name, role } = await nameCustomCoworker(step.asked)
    return writePlan(ctx, { title, items: [{ kind: 'agent', name, role, box: pinned[0] }], boxes: pinned.map(box => ({ name: box })) }, ['agent'], step.asked)
}

function confirmedCard(message: UIMessage): boolean {
    return message.role === 'assistant' && (confirmedPlanCard(message) || chosenTemplatePlan(message) !== null)
}

function isKickoff(message: UIMessage): boolean {
    return message.role === 'user' && (message.parts as LoosePart[]).some(part => part.type === 'text' && typeof part.text === 'string' && isKickoffText(part.text))
}

export function scriptedIntent(phase: ForemanPhase, messages: UIMessage[]): ScriptedIntent | null {
    if (phase === 'build') return 'build'

    const last = messages.at(-1)
    if (!last) return null

    if (phase === 'plan') return confirmedCard(last) ? 'confirm_plan' : null

    if (phase === 'trial') return confirmedCard(last) || isKickoff(last) ? 'offer_trial' : null

    return null
}

export type PreparedScript = { script: ForemanScript } | { planError: string } | null

export async function prepareScript(ctx: WorkspaceContext, state: ForemanState, messages: UIMessage[]): Promise<PreparedScript> {
    const pack = starterPackStep(state, messages)
    if (pack?.kind === 'offer') {
        const offered = await loadStarterPack(ctx, state)
        return offered ? { script: { kind: 'offer_pack', pack: offered } } : null
    }

    const arrived = arrivedReadyMadePlan(state, messages)
    const intent = arrived || pack ? 'confirm_plan' : scriptedIntent(state.phase, messages)
    if (!intent) return null
    if (intent === 'offer_trial') return { script: { kind: 'offer_trial' } }
    if (intent === 'build') return { script: await buildOrPurchase(ctx, state) }

    let next: ForemanState
    try {
        const last = messages.at(-1)
        const readyMade = arrived ? arrived.shown : last ? chosenTemplatePlan(last) : null
        const installedFirst = !!arrived && !state.foreman.profileAt
        const written = pack
            ? await writeStarterPlan(ctx, state, pack)
            : readyMade
              ? await writePlan(ctx, { ...readyMade, title: state.answers.company_name ?? state.workspaceName }, planKinds(state), null, installedFirst)
              : await writePlan(ctx, lastShownPlan(messages), planKinds(state), planRevisionAsk(messages), false, state.foreman)
        const foreman = { ...state.foreman, ...written }
        next = { ...state, foreman, answers: { ...state.answers, foreman } }
    } catch (err) {
        const reason = err instanceof Error ? err.message : String(err)
        if (!pack) return { planError: reason }
        console.error('[foreman] starter pack plan refused:', reason)
        const offered = await loadStarterPack(ctx, state)
        return offered ? { script: { kind: 'offer_pack', pack: offered } } : { planError: reason }
    }

    const phase = foremanPhase({ foreman: next.foreman, onboardingCompletedAt: next.onboardingCompletedAt, entitled: next.entitled, trialing: next.trialing, agentCount: next.agents.length, arrivedReadyMade: isNamedReadyMade(next.intent) })
    const shown = arrived?.template ? { template: arrived.template } : {}
    if (phase === 'trial') return { script: { kind: 'offer_trial', ...shown } }
    if (phase === 'build') return { script: { ...(await buildOrPurchase(ctx, { ...next, phase })), ...shown } }
    return null
}

async function buildOrPurchase(ctx: WorkspaceContext, state: ForemanState): Promise<ForemanScript> {
    const purchase = await owedTemplatePurchase(ctx, state.foreman.plan)
    return purchase ? { kind: 'offer_purchase', purchase } : { kind: 'build', state }
}

export async function runScript(script: ForemanScript, { ctx, writer, signal, reload }: { ctx: WorkspaceContext; writer: UIMessageStreamWriter; signal?: AbortSignal; reload: () => Promise<ForemanState> }): Promise<void> {
    const toolCallId = TOOL_CALL_ID()
    writer.write({ type: 'start' })
    writer.write({ type: 'start-step' })

    if (script.kind === 'offer_pack') {
        writer.write({ type: 'tool-input-available', toolCallId, toolName: SHOW_STARTER_PACK_TOOL, input: script.pack })
        writer.write({ type: 'finish-step' })
        writer.write({ type: 'finish' })
        return
    }

    if (script.template) {
        const cardCallId = TOOL_CALL_ID()
        writer.write({ type: 'tool-input-available', toolCallId: cardCallId, toolName: SHOW_TEMPLATES_TOOL, input: script.template })
        writer.write({ type: 'tool-output-available', toolCallId: cardCallId, output: { answered: true, chosen: script.template.templates[0].slug } })
    }

    if (script.kind === 'offer_trial' || script.kind === 'offer_purchase') {
        if (script.kind === 'offer_trial') writer.write({ type: 'tool-input-available', toolCallId, toolName: OPEN_CHECKOUT_TOOL, input: {} })
        else writer.write({ type: 'tool-input-available', toolCallId, toolName: OPEN_TEMPLATE_PURCHASE_TOOL, input: script.purchase })
        writer.write({ type: 'finish-step' })
        writer.write({ type: 'finish' })
        return
    }

    writer.write({ type: 'tool-input-available', toolCallId, toolName: BUILD_TEAM_TOOL, input: {} })
    const emit = (tasks: SubRunTask[]) => writer.write({ type: 'data-delegate', id: toolCallId, data: { tasks } })
    try {
        const result = await buildTeamOnce({ ctx, state: script.state, emit, signal, reload })
        writer.write({ type: 'tool-output-available', toolCallId, output: result })
    } catch (err) {
        writer.write({ type: 'tool-output-error', toolCallId, errorText: err instanceof Error ? err.message : String(err) })
    }
    writer.write({ type: 'finish-step' })
    writer.write({ type: 'start-step' })
    writer.write({ type: 'finish-step' })
    writer.write({ type: 'finish' })
}
