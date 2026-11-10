import type { UIMessage } from 'ai'

import { findPendingWidget } from './pending-widget'

// What the funnel hands over once the agent is built: the one button that starts it, read off the
// build's own result rather than asked of the model. The build ends the stream without a turn of
// its own, so without it the conversation stops on a composer with nothing to say.
//
// Before the build, the trial: once the card came back refused or still pending and the foreman
// answered, the folded card is up the conversation, out of sight, and the reply points at the button
// under it.

export type ForemanNextStep =
    // The agent that goes first: its install only runs once they press this.
    | { kind: 'start_lead'; label: string; startedLabel: string; agentId: string }
    | { kind: 'billing'; label: string }
    | { kind: 'checkout'; label: string; trigger: 'foreman' | 'trial_refused' }

// The slice of build-team's result the browser reads. That module is server-only.
type BuiltAgent = { agentId: string; name?: string; active: boolean; lead?: boolean }

type LoosePart = { type: string; state?: string; output?: unknown }

type CheckoutStep = Extract<ForemanNextStep, { kind: 'checkout' }>

export type ForemanNextStepCopy = (key: 'startPlan' | 'startTrial' | 'startInstalling' | 'startInstallingMine' | 'installStarted' | 'yourInstallStarted' | 'turnOn', values?: { name: string }) => string

type NextStepOptions = { entitled: boolean; t: ForemanNextStepCopy }

function builtAgents(message: UIMessage | undefined): BuiltAgent[] {
    if (message?.role !== 'assistant') return []
    const build = (message.parts as LoosePart[]).findLast(part => part.type === 'tool-build_team')
    if (build?.state !== 'output-available') return []
    const agents = (build.output as { agents?: unknown } | null)?.agents
    return Array.isArray(agents) ? (agents as BuiltAgent[]) : []
}

function lastCheckout(messages: UIMessage[]): LoosePart | undefined {
    return messages.flatMap(message => message.parts as LoosePart[]).findLast(part => part.type === 'tool-open_checkout')
}

/**
 * Where the trial stands once its card went up and until the team is built: the composer gives way
 * to it, since everything typed there would be a free model turn that does not start the trial.
 */
export type TrialStep = 'trial' | 'trial_refused'

export function trialStep(messages: UIMessage[], { entitled }: { entitled: boolean }): TrialStep | null {
    if (entitled) return null
    if (messages.some(message => message.parts.some(part => part.type === 'tool-build_team'))) return null
    const checkout = lastCheckout(messages)
    if (!checkout) return null
    const output = checkout.state === 'output-available' ? (checkout.output as { ok?: unknown; reason?: unknown } | null) : null
    if (output?.ok === true) return null
    return output?.reason === 'trial_refused' ? 'trial_refused' : 'trial'
}

function reopenedCheckout(messages: UIMessage[], { entitled, t }: NextStepOptions): CheckoutStep | null {
    const last = messages.at(-1)
    if (last?.role !== 'assistant') return null
    if ((last.parts as LoosePart[]).some(part => part.type === 'tool-open_checkout')) return null
    if (findPendingWidget(messages, 'ready')) return null
    if (lastCheckout(messages)?.state !== 'output-available') return null
    const step = trialStep(messages, { entitled })
    if (!step) return null
    return step === 'trial_refused' ? { kind: 'checkout', label: t('startPlan'), trigger: 'trial_refused' } : { kind: 'checkout', label: t('startTrial'), trigger: 'foreman' }
}

/** Only while the build, or the foreman's answer past the trial card, is the last thing said. */
export function foremanNextSteps(messages: UIMessage[], options: NextStepOptions): ForemanNextStep[] {
    const { t } = options
    const agents = builtAgents(messages.at(-1))
    if (!agents.length) {
        const checkout = reopenedCheckout(messages, options)
        return checkout ? [checkout] : []
    }

    const lead = agents.find(agent => agent.active && agent.lead)
    if (lead) {
        return [
            {
                kind: 'start_lead',
                label: lead.name ? t('startInstalling', { name: lead.name }) : t('startInstallingMine'),
                startedLabel: lead.name ? t('installStarted', { name: lead.name }) : t('yourInstallStarted'),
                agentId: lead.agentId,
            },
        ]
    }
    // Built without a free slot on their plan: there is nothing to start until one is opened.
    return [{ kind: 'billing', label: t('turnOn') }]
}
