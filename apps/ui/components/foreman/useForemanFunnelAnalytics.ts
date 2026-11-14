'use client'

import type { UIMessage } from 'ai'
import { useEffect, useRef } from 'react'

import { track } from '@rerun/analytics/client'

import { readQuestionOutput } from '@/components/foreman/widgets/question-answer'
import { readOwnAsk } from '@/lib/foreman/kickoff-marker'
import { readStarterPackAnswer } from '@/lib/foreman/starter-pack'

type ToolPart = { type: string; toolCallId?: string; state?: string; input?: unknown; output?: unknown; text?: unknown }

const NEXT_STEP: Record<string, string> = { discover: 'plan', plan: 'build', trial: 'build' }

type PlanVia = 'plan_card' | 'template' | 'starter_pack' | 'custom'

function step(name: string, once: (key: string) => boolean, options: { via?: PlanVia; opensNext?: boolean } = {}): void {
    if (!once(`completed:${name}`)) return
    track('onboarding_step_completed', options.via ? { step: name, via: options.via } : { step: name })
    const next = NEXT_STEP[name]
    if (next && options.opensNext !== false && once(`viewed:${next}`)) track('onboarding_step_viewed', { step: next })
}

const CHECKOUT_REASONS = ['trial_refused', 'dismissed', 'pending'] as const
type CheckoutReason = (typeof CHECKOUT_REASONS)[number]

export function viewTrialStep(once: (key: string) => boolean): void {
    if (once('viewed:trial')) track('onboarding_step_viewed', { step: 'trial' })
}

function strings(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

export function emitOwnAsk(once: (key: string) => boolean, entitled: boolean): void {
    track('onboarding_plan_answered', { confirmed: true, agents: 1, via: 'custom', from: 'intake' })
    step('plan', once, { via: 'custom', opensNext: entitled })
}

function carriesOwnAsk(message: UIMessage): boolean {
    return message.role === 'user' && message.parts.some(part => part.type === 'text' && typeof (part as ToolPart).text === 'string' && readOwnAsk((part as ToolPart).text as string) !== null)
}

export function emit(name: string, input: unknown, output: unknown, once: (key: string) => boolean, entitled: boolean): void {
    switch (name) {
        case 'ask_choice': {
            const args = (input ?? {}) as { multiple?: unknown; options?: unknown }
            if (args.multiple !== true || !once('use_cases')) return
            const options = strings(args.options)
            const answers = strings((output as { answers?: unknown } | null)?.answers)
            return track('onboarding_use_cases_selected', { proposed: options.length, selected: answers.length, custom: answers.some(answer => !options.includes(answer)) })
        }
        case 'ask_either': {
            const answer = readQuestionOutput(output)
            track('onboarding_either_answered', { outcome: answer?.answered ? 'picked' : (answer?.reason ?? 'abandoned') })
            const answers = answer?.answered ? answer.answers : []
            if (!answers.length || !once('use_cases')) return
            const options = strings(((input ?? {}) as { options?: unknown }).options)
            return track('onboarding_use_cases_selected', { proposed: options.length, selected: answers.length, custom: false })
        }
        case 'save_profile':
            return step('discover', once)
        case 'show_plan': {
            const answer = (output ?? {}) as { answered?: unknown; confirmed?: unknown }
            if (answer.answered !== true) return
            const items = ((input ?? {}) as { items?: unknown[] }).items ?? []
            const confirmed = answer.confirmed === true
            track('onboarding_plan_answered', { confirmed, agents: items.length })
            if (confirmed) step('plan', once, { via: 'plan_card', opensNext: entitled })
            return
        }
        case 'show_templates':
            if (typeof (output as { chosen?: unknown } | null)?.chosen === 'string') step('plan', once, { via: 'template', opensNext: entitled })
            return
        case 'show_starter_pack': {
            const answer = readStarterPackAnswer(output)
            if (!answer?.answered) return
            const custom = 'custom' in answer
            track('onboarding_plan_answered', { confirmed: true, agents: custom ? 1 : answer.chosen.length, via: custom ? 'custom' : 'starter_pack', ...(custom ? { from: 'pack' } : { picked: answer.chosen }) })
            return step('plan', once, { via: custom ? 'custom' : 'starter_pack', opensNext: entitled })
        }
        case 'open_checkout': {
            const answer = (output ?? {}) as { ok?: unknown; reason?: unknown }
            const ok = answer.ok === true
            const reason = CHECKOUT_REASONS.find(known => known === answer.reason) as CheckoutReason | undefined
            track('onboarding_checkout_answered', ok || !reason ? { ok } : { ok, reason })
            if (ok) step('trial', once)
            return
        }
        case 'contact_team':
            return track('onboarding_help_answered', { sent: (output as { sent?: unknown } | null)?.sent === true })
        case 'build_team': {
            const result = (output ?? {}) as { agents?: unknown[]; failed?: unknown[] }
            const agents = result.agents?.length ?? 0
            track('onboarding_team_built', { agents, failed: result.failed?.length ?? 0, error: false })
            if (agents === 0) return
            track('first_agent_created', { template: 'foreman' })
            return step('build', once)
        }
    }
}

export function useForemanFunnelAnalytics({ messages, guided, restoreDone, entitled }: { messages: UIMessage[]; guided: boolean; restoreDone: boolean; entitled: boolean }) {
    const counted = useRef(new Set<string>())
    const steps = useRef(new Set<string>())
    const once = (key: string) => (steps.current.has(key) ? false : (steps.current.add(key), true))
    const seeded = useRef(false)

    useEffect(() => {
        if (!guided || !restoreDone) return
        if (!seeded.current) {
            seeded.current = true
            for (const message of messages) {
                if (message.role === 'user') counted.current.add(message.id)
                for (const part of message.parts) {
                    const id = (part as ToolPart).toolCallId
                    if (id) counted.current.add(id)
                }
            }
            return
        }
        for (const message of messages) {
            if (message.role === 'user' && !counted.current.has(message.id)) {
                counted.current.add(message.id)
                if (carriesOwnAsk(message)) emitOwnAsk(once, entitled)
            }
            for (const part of message.parts) {
                const tool = part as ToolPart
                if (!tool.type.startsWith('tool-') || !tool.toolCallId || counted.current.has(tool.toolCallId)) continue
                if (tool.state === 'output-error' && tool.type === 'tool-build_team') {
                    counted.current.add(tool.toolCallId)
                    track('onboarding_team_built', { agents: 0, failed: 0, error: true })
                    continue
                }
                if (tool.type === 'tool-open_checkout' && tool.state !== 'output-error') viewTrialStep(once)
                if (tool.state !== 'output-available') continue
                counted.current.add(tool.toolCallId)
                emit(tool.type.slice('tool-'.length), tool.input, tool.output, once, entitled)
            }
        }
    }, [messages, guided, restoreDone, entitled])
}
