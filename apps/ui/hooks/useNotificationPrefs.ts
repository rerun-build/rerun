'use client'

import { useErrorText } from '@/hooks/useErrorText'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useMemo } from 'react'
import { toast } from 'sonner'
import { create } from 'zustand'

import { updateNotificationPrefsAction } from '@/app/api/_actions/notifications.actions'
import { coworkerRuleOf, mergeNotificationPrefs, normalizeNotificationPrefs, type CoworkerRule, type NotificationPrefs, type NotificationPrefsPatch } from '@/lib/notifications/prefs'
import { useSession } from '@/supabase/session/SessionProvider'

const usePendingPrefs = create<{ pending: NotificationPrefs | null; basis: unknown; inFlight: number }>(() => ({ pending: null, basis: undefined, inFlight: 0 }))

let saving: Promise<void> = Promise.resolve()

export function useNotificationPrefs() {
    const { user } = useSession()
    const stored = user?.email_notification_prefs
    const pending = usePendingPrefs(s => s.pending)
    const t = useTranslations('notifications.settings')
    const errorText = useErrorText()

    useEffect(() => {
        const { basis, inFlight } = usePendingPrefs.getState()
        if (basis === stored) return
        usePendingPrefs.setState(inFlight === 0 ? { pending: null, basis: stored } : { basis: stored })
    }, [stored])

    const prefs = useMemo(() => pending ?? normalizeNotificationPrefs(stored), [pending, stored])

    const update = useCallback(
        (patch: NotificationPrefsPatch) => {
            const current = usePendingPrefs.getState().pending ?? normalizeNotificationPrefs(stored)
            usePendingPrefs.setState(s => ({ pending: mergeNotificationPrefs(current, patch), basis: stored, inFlight: s.inFlight + 1 }))
            saving = saving
                .then(async () => {
                    const result = await updateNotificationPrefsAction(patch).catch(() => ({ ok: false as const, error: t('networkError') }))
                    if (result.ok) return
                    usePendingPrefs.setState({ pending: null })
                    toast.error(t('saveFailed'), { description: errorText(result) })
                })
                .finally(() => usePendingPrefs.setState(s => ({ inFlight: s.inFlight - 1 })))
        },
        [stored, t, errorText]
    )

    const setCoworkerRule = useCallback((agentId: string, rule: CoworkerRule) => update({ coworkers: { [agentId]: rule } }), [update])

    const ruleOf = useCallback((agentId: string | null | undefined) => coworkerRuleOf(prefs, agentId), [prefs])

    return { prefs, update, setCoworkerRule, ruleOf }
}
