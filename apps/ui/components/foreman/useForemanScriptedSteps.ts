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

type LoosePart = { type: string; toolCallId?: string; state?: string; output?: unknown }

const RECENTER_DELAY_MS = 400

function partsOf(messages: UIMessage[]): LoosePart[] {
    return messages.flatMap(message => message.parts as LoosePart[])
}

function builtTeamIds(messages: UIMessage[]): string[] {
    return partsOf(messages).flatMap(part => (part.type === 'tool-build_team' && part.state === 'output-available' && part.toolCallId ? [part.toolCallId] : []))
}

function funnelFinished(messages: UIMessage[]): boolean {
    return partsOf(messages).some(part => part.state === 'output-available' && part.type === 'tool-build_team' && ((part.output as { agents?: unknown[] } | null)?.agents?.length ?? 0) > 0)
}

function builtLead(messages: UIMessage[], toolCallIds: string[]): string | null {
    const build = partsOf(messages).find(part => part.type === 'tool-build_team' && part.state === 'output-available' && !!part.toolCallId && toolCallIds.includes(part.toolCallId))
    return (build?.output as { lead?: { agentId?: string } | null } | null)?.lead?.agentId ?? null
}

function purchaseAwaitingBuild(messages: UIMessage[]): boolean {
    const parts = partsOf(messages)
    if (parts.some(part => part.type === 'tool-build_team')) return false
    const purchase = parts.findLast(part => part.type === 'tool-open_template_purchase')
    return purchase?.state === 'output-available' && (purchase.output as { ok?: unknown } | null)?.ok !== true
}

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
        setTimeout(() => useBoardStore.getState().recenterBoard(), RECENTER_DELAY_MS)
    }, [messages, restoreDone])

    const finished = guided && funnelFinished(messages)
    const builtThisVisit = useRef(false)
    useEffect(() => {
        if (!finished) return
        const onboarding = useOnboardingStore.getState()
        onboarding.clearPendingTemplateLink()
        onboarding.clearPendingShareLink()
        builtThisVisit.current = true
        void settleBuiltFunnel().then(next => {
            const lead = freshLead.current
            freshLead.current = null
            if (next === 'skipped' && lead) void startLeadInstall(lead, installFailedRef.current, errorTextRef.current)
        })
    }, [finished])

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
        asked.current = send(KICKOFF_MARKER)
    }, [lateStart, send])
}
