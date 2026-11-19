'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { dismissGettingStartedAction, restoreGettingStartedAction } from '@/app/api/_actions/getting-started.actions'
import { GETTING_STARTED_STEPS, isComplete, progressOf, rewardOf, type GettingStartedState, type GettingStartedStepId } from '@/lib/onboarding/getting-started'
import { isPhoneStepDone } from '@moldwright/cloud/phone'
import { useForemanStore } from '@/stores/foreman.store'
import { createClient } from '@/supabase/client'
import { useSession } from '@/supabase/session/SessionProvider'
import { selectMany } from '@/supabase/supabase-helpers'
import { useRealtimeSubscription } from '@/supabase/useRealtimeSubscription'

const STEP_IDS = new Set<string>(GETTING_STARTED_STEPS.map(step => step.id))

type LiveStep = { step: GettingStartedStepId; complete: boolean }

type SyncResult = { visible: boolean; dismissed?: boolean }

async function syncGettingStarted(): Promise<SyncResult> {
    const res = await fetch('/api/getting-started/sync', { method: 'POST' }).catch(() => null)
    if (!res?.ok) return { visible: false }
    return (await res.json()) as SyncResult
}

export function useGettingStarted({ enabled, onLiveStep }: { enabled: boolean; onLiveStep?: (live: LiveStep) => void }) {
    const { workspace, phoneStatus } = useSession()
    const workspaceId = workspace?.id
    const [items, setItems] = useState<ReadonlySet<string> | null>(null)
    const [visible, setVisible] = useState(false)
    const [dismissed, setDismissed] = useState(false)
    const itemsRef = useRef<ReadonlySet<string>>(new Set())
    const phoneRef = useRef(phoneStatus)

    const load = useCallback(async () => {
        if (!workspaceId) return
        const { data } = await selectMany(createClient(), 'workspace_getting_started', ['item'] as const, { workspace_id: workspaceId })
        const next = new Set((data ?? []).map(row => row.item))
        itemsRef.current = next
        setItems(next)
    }, [workspaceId])

    useEffect(() => {
        if (!enabled || !workspaceId) return
        let cancelled = false
        void syncGettingStarted().then(result => {
            if (cancelled) return
            setVisible(result.visible)
            setDismissed(!!result.dismissed)
            if (result.visible) void load()
        })
        return () => {
            cancelled = true
        }
    }, [enabled, workspaceId, load])

    const available = enabled && (visible || dismissed)
    useEffect(() => {
        useForemanStore.getState().setGettingStartedAvailable(available)
    }, [available])

    const apply = useCallback((next: ReadonlySet<string>) => {
        itemsRef.current = next
        setItems(next)
    }, [])

    useRealtimeSubscription('workspace_getting_started', {
        channelId: `getting-started-ws-${workspaceId}`,
        filter: workspaceId ? { column: 'workspace_id', value: workspaceId } : undefined,
        enabled: enabled && visible && !!workspaceId,
        onInsert: row => {
            if (itemsRef.current.has(row.item)) return
            const next = new Set(itemsRef.current).add(row.item)
            apply(next)
            if (row.item === 'dismissed') {
                setVisible(false)
                setDismissed(true)
            }
            if (!STEP_IDS.has(row.item)) return
            const complete = isComplete(progressOf(next, phoneRef.current))
            onLiveStep?.({ step: row.item as GettingStartedStepId, complete })
            if (complete && !next.has('reward')) void syncGettingStarted()
        },
        onDelete: row => {
            if (row.workspace_id !== workspaceId) return
            const next = new Set(itemsRef.current)
            next.delete(row.item)
            apply(next)
        },
        onResync: () => void load(),
    })

    useEffect(() => {
        if (!enabled || !items) return
        const previous = phoneRef.current
        phoneRef.current = phoneStatus
        if (!phoneStatus || !isPhoneStepDone(phoneStatus) || (previous !== 'skipped' && previous !== 'pending')) return
        const complete = isComplete(progressOf(items, phoneStatus))
        onLiveStep?.({ step: 'phone', complete })
        if (complete && !items.has('reward')) void syncGettingStarted()
    }, [phoneStatus, enabled, items, onLiveStep])

    const dismiss = useCallback(() => {
        setVisible(false)
        setDismissed(true)
        void dismissGettingStartedAction().catch(() => {})
    }, [])

    const restore = useCallback(async () => {
        if (!dismissed) return
        await restoreGettingStartedAction()
        setDismissed(false)
        setVisible(true)
        await load()
    }, [dismissed, load])

    const state = useMemo<GettingStartedState | null>(() => {
        if (!items || !workspace) return null
        return { progress: progressOf(items, phoneStatus), reward: rewardOf(items, workspace) }
    }, [items, workspace, phoneStatus])

    return { state: visible ? state : null, dismiss, restore }
}
