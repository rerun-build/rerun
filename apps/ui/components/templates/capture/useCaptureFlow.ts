'use client'

import { useErrorText } from '@/hooks/useErrorText'
import { defaultExcludedPaths, isSetupAnswered } from '@rerun/contracts'
import * as React from 'react'
import { useTranslations } from 'next-intl'
import type { AgentCapturePlan, CaptureSourceSpace } from '@/lib/templates/capture'
import type { AgentSetupDraft } from '@/components/agent/AgentSetupFields'
import type { CaptureActions } from './types'

export type CaptureStep = 'select' | 'review' | 'done'

// `excluded` and `approved` are both keyed by the agent row id rather than by the engine id the
// plan carries: two rows can address the same folder, and the capture itself speaks row ids.
export type CaptureFlow = {
    spaces: CaptureSourceSpace[]
    loadingSpaces: boolean
    spaceId: string
    setSpaceId: (spaceId: string) => void
    selectedIds: string[]
    toggleAgent: (agentId: string) => void
    setSelection: (agentIds: string[]) => void
    plans: AgentCapturePlan[]
    excluded: Record<string, string[]>
    toggleFiles: (agentRowId: string, paths: string[], keep: boolean) => void
    approved: Record<string, boolean>
    setApproval: (agentRowId: string, next: boolean) => void
    setups: Record<string, AgentSetupDraft>
    setSetup: (agentRowId: string, next: AgentSetupDraft) => void
    approvedCount: number
    allApproved: boolean
    warnings: string[]
    busy: boolean
    error: string | null
    inspect: () => Promise<boolean>
    capture: () => Promise<boolean>
}

// The state machine behind the capture wizard, without any chrome: `inspect` and `capture` answer
// whether they succeeded and the shell owns the stepping, so the same flow drives a standalone
// dialog and a step inside a longer wizard.
export function useCaptureFlow(actions: CaptureActions): CaptureFlow {
    const t = useTranslations('templates.capture')
    const errorText = useErrorText()
    // A server action rejects rather than answering when the request itself fails (offline, a
    // redeploy invalidating the action id), and a silent no-op reads as "nothing happened, click again".
    const failedRequest = t('failedRequest')
    const [spaces, setSpaces] = React.useState<CaptureSourceSpace[]>([])
    const [spaceId, setSpaceIdState] = React.useState('')
    const [selectedIds, setSelectedIds] = React.useState<string[]>([])
    const [plans, setPlans] = React.useState<AgentCapturePlan[]>([])
    const [excluded, setExcluded] = React.useState<Record<string, string[]>>({})
    const [approved, setApproved] = React.useState<Record<string, boolean>>({})
    const [setups, setSetups] = React.useState<Record<string, AgentSetupDraft>>({})
    const [warnings, setWarnings] = React.useState<string[]>([])
    const [loadingSpaces, setLoadingSpaces] = React.useState(true)
    const [busy, setBusy] = React.useState(false)
    const [error, setError] = React.useState<string | null>(null)

    // Held in a ref so a shell that rebuilds its actions object on every render does not re-run the
    // load. The flow is mounted only while its step is on screen, so the mount value is the one.
    const listSourcesRef = React.useRef(actions.listSources)
    const failedRequestRef = React.useRef(failedRequest)
    const errorTextRef = React.useRef(errorText)

    React.useEffect(() => {
        let cancelled = false
        listSourcesRef.current()
            .then(result => {
                if (cancelled) return
                if (!result.ok) {
                    setError(errorTextRef.current(result))
                    return
                }
                setSpaces(result.spaces)
                // A sandbox holds a single space, so asking which one would be a step for nothing.
                if (result.spaces.length === 1) setSpaceIdState(result.spaces[0].id)
            })
            .catch(() => {
                if (!cancelled) setError(failedRequestRef.current)
            })
            .finally(() => {
                if (!cancelled) setLoadingSpaces(false)
            })
        return () => {
            cancelled = true
        }
    }, [])

    const setSpaceId = React.useCallback((next: string) => {
        setSpaceIdState(next)
        setSelectedIds([])
    }, [])

    const toggleAgent = React.useCallback((agentId: string) => {
        setSelectedIds(ids => (ids.includes(agentId) ? ids.filter(id => id !== agentId) : [...ids, agentId]))
    }, [])

    const toggleFiles = React.useCallback((agentRowId: string, paths: string[], keep: boolean) => {
        setExcluded(current => {
            const list = current[agentRowId] ?? []
            const touched = new Set(paths)
            const next = keep ? list.filter(path => !touched.has(path)) : [...new Set([...list, ...paths])]
            return { ...current, [agentRowId]: next }
        })
    }, [])

    const setApproval = React.useCallback((agentRowId: string, next: boolean) => {
        setApproved(current => ({ ...current, [agentRowId]: next }))
    }, [])

    const setSetup = React.useCallback((agentRowId: string, next: AgentSetupDraft) => {
        setSetups(current => ({ ...current, [agentRowId]: next }))
    }, [])

    const inspect = React.useCallback(async () => {
        setError(null)
        setBusy(true)
        try {
            const result = await actions.plan({ spaceId, agentIds: selectedIds })
            if (!result.ok) {
                setError(errorText(result))
                return false
            }
            setPlans(result.plans)
            // The engine decides what starts unchecked: it is the only side that knows a path is
            // a memory, a secrets folder or a file it already redacted.
            setExcluded(Object.fromEntries(result.plans.map(plan => [plan.agentRowId, defaultExcludedPaths(plan)])))
            setSetups(Object.fromEntries(result.plans.map(plan => [plan.agentRowId, { required: plan.setup.required, prompt: plan.setup.prompt }])))
            // Re-inspecting answers a fresh plan, so a review signed off against the previous one
            // says nothing about this archive.
            setApproved({})
            return true
        } catch {
            setError(failedRequest)
            return false
        } finally {
            setBusy(false)
        }
    }, [actions, spaceId, selectedIds, failedRequest, errorText])

    const capture = React.useCallback(async () => {
        setError(null)
        setBusy(true)
        try {
            const selections = plans.map(plan => {
                const setup = setups[plan.agentRowId]
                return {
                    agentRowId: plan.agentRowId,
                    exclude: excluded[plan.agentRowId] ?? [],
                    ...(setup?.required === null || setup === undefined ? {} : { setup: { required: setup.required, prompt: setup.prompt } }),
                }
            })
            const result = await actions.capture({ spaceId, selections })
            if (!result.ok) {
                setError(errorText(result))
                return false
            }
            setWarnings(result.warnings)
            return true
        } catch {
            setError(failedRequest)
            return false
        } finally {
            setBusy(false)
        }
    }, [actions, plans, excluded, setups, spaceId, failedRequest, errorText])

    // An agent whose setup question is still unanswered cannot be signed off: the answer is what a
    // template is submitted on, and after the capture it is too late to ask. Re-checked here rather
    // than left to the checkbox, because emptying the instructions after signing off deliberately
    // keeps the sign-off.
    const approvedCount = plans.filter(plan => {
        const setup = setups[plan.agentRowId]
        return approved[plan.agentRowId] && setup !== undefined && isSetupAnswered(setup)
    }).length

    return {
        spaces,
        loadingSpaces,
        spaceId,
        setSpaceId,
        selectedIds,
        toggleAgent,
        setSelection: setSelectedIds,
        plans,
        excluded,
        toggleFiles,
        approved,
        setApproval,
        setups,
        setSetup,
        approvedCount,
        allApproved: plans.length > 0 && approvedCount === plans.length,
        warnings,
        busy,
        error,
        inspect,
        capture,
    }
}
