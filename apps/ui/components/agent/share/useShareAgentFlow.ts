'use client'

import { useErrorText, type Refusal } from '@/hooks/useErrorText'
import type { AgentShareInclude } from '@rerun/contracts'
import { track } from '@rerun/analytics/client'
import { useTranslations } from 'next-intl'
import * as React from 'react'
import type { AgentSharePlan } from '@/lib/agents/share-create'

type ShareRefusal = { ok: false; error: string } & Pick<Refusal, 'code' | 'params'>

export type SharePlanResult = { ok: true; plan: AgentSharePlan } | ShareRefusal
export type ShareCreateResult = { ok: true; url: string; warnings: string[]; reused: boolean } | ShareRefusal

export type ShareActions = {
    plan: () => Promise<SharePlanResult>
    create: (include: AgentShareInclude) => Promise<ShareCreateResult>
}

const DEFAULT_INCLUDE: AgentShareInclude = { memories: false, database: false, files: false }

export type ShareStep = 'configure' | 'link'

export type ShareFlow = {
    step: ShareStep
    plan: AgentSharePlan | null
    loading: boolean
    include: AgentShareInclude
    setInclude: (next: Partial<AgentShareInclude>) => void
    carriesData: boolean
    url: string | null
    reused: boolean
    busy: boolean
    error: string | null
    create: () => Promise<void>
}

export function useShareAgentFlow(actions: ShareActions): ShareFlow {
    const failedRequest = useTranslations('agent.useShareAgentFlow')('failedRequest')
    const errorText = useErrorText()
    const [plan, setPlan] = React.useState<AgentSharePlan | null>(null)
    const [loading, setLoading] = React.useState(true)
    const [include, setIncludeState] = React.useState<AgentShareInclude>(DEFAULT_INCLUDE)
    const [url, setUrl] = React.useState<string | null>(null)
    const [reused, setReused] = React.useState(false)
    const [busy, setBusy] = React.useState(false)
    const [error, setError] = React.useState<string | null>(null)

    const planRef = React.useRef(actions.plan)

    React.useEffect(() => {
        let cancelled = false
        planRef
            .current()
            .then(result => {
                if (cancelled) return
                if (!result.ok) setError(errorText(result))
                else setPlan(result.plan)
            })
            .catch(() => {
                if (!cancelled) setError(failedRequest)
            })
            .finally(() => {
                if (!cancelled) setLoading(false)
            })
        return () => {
            cancelled = true
        }
    }, [failedRequest, errorText])

    const setInclude = React.useCallback((next: Partial<AgentShareInclude>) => {
        setIncludeState(current => ({ ...current, ...next }))
    }, [])

    const create = React.useCallback(async () => {
        setError(null)
        setBusy(true)
        try {
            const result = await actions.create(include)
            if (!result.ok) {
                setError(errorText(result))
                return
            }
            setUrl(result.url)
            setReused(result.reused)
            if (!result.reused) track('agent_share_created', { carries_memories: include.memories, carries_database: include.database, carries_files: include.files })
        } catch {
            setError(failedRequest)
        } finally {
            setBusy(false)
        }
    }, [actions, include, failedRequest, errorText])

    return {
        step: url ? 'link' : 'configure',
        plan,
        loading,
        include,
        setInclude,
        carriesData: include.memories || include.database || include.files,
        url,
        reused,
        busy,
        error,
        create,
    }
}
