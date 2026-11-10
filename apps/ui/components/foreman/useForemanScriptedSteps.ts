'use client'

import { useErrorText } from '@/hooks/useErrorText'
import type { ChatStatus, UIMessage } from 'ai'
import { useTranslations } from 'next-intl'
import { useEffect, useRef } from 'react'

import { startLeadInstall } from '@/components/foreman/ForemanNextSteps'
import { settleBuiltFunnel } from '@/components/foreman/useForemanKickoff'
import { isSubscriptionEntitled } from '@rerun/cloud/billing'
import { KICKOFF_MARKER } from '@/lib/foreman/kickoff-marker'
import { browserPermission } from '@/lib/notifications/browser'
import { useBoardStore } from '@/stores/board.store'
import { useNotificationsStore } from '@/stores/notifications.store'
import { useOnboardingStore } from '@/stores/onboarding.store'
import { useSession } from '@/supabase/session/SessionProvider'

// The browser's half of the steps the app runs without the model (lib/foreman/scripted.ts): framing
// the board on the team the moment it is built, leaving the funnel once that build lands and handing
// the workspace to the foreman on its engine, and asking for the build when the trial started from a
// card that had already answered, which brings no request of its own.

type LoosePart = { type: string; toolCallId?: string; state?: string; output?: unknown }

// Long enough for the Boxes the build inserted to arrive over realtime, which the framing is read
// from, short enough to land while the build block is still the last thing on screen.
const RECENTER_DELAY_MS = 400

function partsOf(messages: UIMessage[]): LoosePart[] {
    return messages.flatMap(message => message.parts as LoosePart[])
}

function builtTeamIds(messages: UIMessage[]): string[] {
    return partsOf(messages).flatMap(part => (part.type === 'tool-build_team' && part.state === 'output-available' && part.toolCallId ? [part.toolCallId] : []))
}

// The build stamps `firstRunAt` on the server, which is what ends the funnel there. A build that
// landed no agent stamps nothing, so it does not end it here either.
function funnelFinished(messages: UIMessage[]): boolean {
    return partsOf(messages).some(part => part.state === 'output-available' && part.type === 'tool-build_team' && ((part.output as { agents?: unknown[] } | null)?.agents?.length ?? 0) > 0)
}

// The build of this visit, as opposed to one read back from the transcript: only that one starts
// the coworker it just installed.
function builtLead(messages: UIMessage[], toolCallIds: string[]): string | null {
    const build = partsOf(messages).find(part => part.type === 'tool-build_team' && part.state === 'output-available' && !!part.toolCallId && toolCallIds.includes(part.toolCallId))
    return (build?.output as { lead?: { agentId?: string } | null } | null)?.lead?.agentId ?? null
}

// The template's card came back sealed rather than answered, and nothing was built after it: the
// conversation has no live card left to buy from.
function purchaseAwaitingBuild(messages: UIMessage[]): boolean {
    const parts = partsOf(messages)
    if (parts.some(part => part.type === 'tool-build_team')) return false
    const purchase = parts.findLast(part => part.type === 'tool-open_template_purchase')
    return purchase?.state === 'output-available' && (purchase.output as { ok?: unknown } | null)?.ok !== true
}

// The trial card answered something other than "started", and no build has followed it: a trial
// started from there afterwards (its "Start free trial" button, the billing panel) is one the hub has
// not heard of.
function checkoutAwaitingBuild(messages: UIMessage[]): boolean {
    const parts = partsOf(messages)
    if (parts.some(part => part.type === 'tool-build_team')) return false
    const checkout = parts.findLast(part => part.type === 'tool-open_checkout')
    return checkout?.state === 'output-available' && (checkout.output as { ok?: unknown } | null)?.ok !== true
}

export function useForemanScriptedSteps({ messages, status, guided, restoreDone, send }: { messages: UIMessage[]; status: ChatStatus; guided: boolean; restoreDone: boolean; send: (text: string) => boolean }) {
    const { workspace } = useSession()
    const t = useTranslations('foreman.nextSteps')
    const installFailedText = t('installFailed')
    const installFailedRef = useRef(installFailedText)
    const errorText = useErrorText()
    const errorTextRef = useRef(errorText)
    useEffect(() => {
        installFailedRef.current = installFailedText
        errorTextRef.current = errorText
    })

    // Seeded once the transcript is back, so a build already on screen from a previous visit does
    // not move the camera on every reload.
    const framed = useRef<Set<string> | null>(null)
    const freshLead = useRef<string | null>(null)
    useEffect(() => {
        if (!restoreDone) return
        const built = builtTeamIds(messages)
        if (framed.current === null) {
            framed.current = new Set(built)
            return
        }
        const fresh = built.filter(id => !framed.current!.has(id))
        if (!fresh.length) return
        for (const id of fresh) framed.current.add(id)
        freshLead.current = builtLead(messages, fresh)
        // Not cleared on the next render: the build's closing frames re-render this right after, and
        // the id is already marked framed by then.
        setTimeout(() => useBoardStore.getState().recenterBoard(), RECENTER_DELAY_MS)
    }, [messages, restoreDone])

    // The phase is read from the server once per identity, so without this the column would stay in
    // the funnel until the next reload, with its "New task" still hidden. The build claimed the
    // machine on its way: the next message goes to the foreman running on it, while the build stays
    // on screen with its buttons.
    const finished = guided && funnelFinished(messages)
    const builtThisVisit = useRef(false)
    // The link the visitor arrived with stays parked through the funnel to hold the other install
    // paths back, and the build has just installed it. Left parked, HomeContent would open its sheet
    // the moment the funnel turns companion and install it a second time, hence cleared first.
    useEffect(() => {
        if (!finished) return
        const onboarding = useOnboardingStore.getState()
        onboarding.clearPendingTemplateLink()
        onboarding.clearPendingShareLink()
        builtThisVisit.current = true
        // A workspace that installed what it arrived on before the welcome card is let off it: the
        // column closes on the coworker's chat, which starts its own setup with no button to press.
        // Everyone else is handed to the foreman on the engine, as before.
        void settleBuiltFunnel().then(next => {
            const lead = freshLead.current
            freshLead.current = null
            if (next === 'skipped' && lead) void startLeadInstall(lead, installFailedRef.current, errorTextRef.current)
        })
    }, [finished])

    // Asked once the build's turn has ended rather than the moment the funnel does, so the dialog
    // does not cover the team landing on the board.
    useEffect(() => {
        if (!builtThisVisit.current || status !== 'ready') return
        builtThisVisit.current = false
        if (browserPermission() === 'default') useNotificationsStore.getState().askPermission()
    }, [finished, status])

    const entitled = isSubscriptionEntitled(workspace?.subscription_status)
    const lateStart = guided && restoreDone && entitled && status === 'ready' && (checkoutAwaitingBuild(messages) || purchaseAwaitingBuild(messages))
    const asked = useRef(false)
    useEffect(() => {
        if (!lateStart || asked.current) return
        // Any request builds once the workspace is entitled with a plan and no agent: the marker is
        // only the one the stack already knows to hide.
        asked.current = send(KICKOFF_MARKER)
    }, [lateStart, send])
}
