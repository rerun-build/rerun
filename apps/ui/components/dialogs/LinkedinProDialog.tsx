'use client'

import { useErrorText } from '@/hooks/useErrorText'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { formatNumber } from '@rerun/i18n/format'
import { useLocale, useTranslations } from 'next-intl'
import { addAppSlotAction, cancelAppConnectAction, connectLinkedinAction, disconnectAppConnectionAction, getAppsOverviewAction, resendAppCodeAction, submitAppCheckpointAction } from '@/app/api/_actions/apps.actions'
import type { AppConnectionView, AppsOverview, ConnectOutcome } from '@/app/api/_services/apps.service'
import { countryFromLocale } from '@/components/apps/linkedin-countries'
import type { ApprovalWait, LinkedinCredentials } from '@/components/apps/LinkedinProViews'
import { LinkedinProDialogView, type LinkedinProScreen } from '@/components/dialogs/LinkedinProDialogView'
import { usePaidAppsStore } from '@/stores/paid-apps.store'
import { randomUuid } from '@/lib/random-uuid'

const ACCOUNTS: LinkedinProScreen = { kind: 'accounts' }
const POLL_MS = 5_000
const SLOW_AFTER_MS = 3 * 60_000

const SLUG = 'linkedin'

type CheckpointResult = Awaited<ReturnType<typeof submitAppCheckpointAction>>

export function LinkedinProDialog() {
    const t = useTranslations('dialogs')
    const errorText = useErrorText()
    const locale = useLocale()
    const open = usePaidAppsStore(s => s.openSlug === SLUG)
    const reconnectId = usePaidAppsStore(s => s.reconnectId)
    const closeApp = usePaidAppsStore(s => s.closeApp)
    const bumpRevision = usePaidAppsStore(s => s.bumpRevision)

    const [overview, setOverview] = useState<AppsOverview | null>(null)
    const [screen, setScreen] = useState<LinkedinProScreen>(ACCOUNTS)
    const [pending, setPending] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    // The connection whose approval has waited long enough to send the person back to the phone.
    const [slowFor, setSlowFor] = useState<string | null>(null)
    const [defaultCountry] = useState(() => countryFromLocale(typeof navigator === 'undefined' ? undefined : navigator.language))

    const load = useCallback(async () => {
        const result = await getAppsOverviewAction(SLUG)
        if (result.ok) setOverview(result.value)
        else setError(errorText(result))
        return result.ok ? result.value : null
    }, [errorText])

    // One checkpoint call at a time, shared by the poll and the button: two answers of "connected"
    // landing together would finish the connection twice, and the second one deletes the account.
    const inFlight = useRef<Promise<CheckpointResult> | null>(null)
    const check = useCallback((connectionId: string, code?: string) => {
        if (inFlight.current) return inFlight.current
        const call = submitAppCheckpointAction(SLUG, connectionId, code).finally(() => {
            inFlight.current = null
        })
        inFlight.current = call
        return call
    }, [])

    const connectionId = screen.kind === 'checkpoint' ? screen.connectionId : null
    const approving = open && screen.kind === 'checkpoint' && screen.checkpointType === 'app_approval'
    const approvalWait: ApprovalWait | null = !approving ? null : slowFor === connectionId ? 'slow' : 'polling'

    // The approval in the LinkedIn app is only visible by asking Linkup, so it is asked every few
    // seconds; a failed poll stays silent, the button surfaces errors once the wait turns slow.
    useEffect(() => {
        if (!approving || !connectionId) return
        let active = true
        const slow = setTimeout(() => setSlowFor(connectionId), SLOW_AFTER_MS)
        const tick = async () => {
            if (!active || inFlight.current) return
            const result = await check(connectionId).catch(() => null)
            if (!active || !result?.ok || result.value.status !== 'connected') return
            setScreen({ kind: 'success', label: result.value.label })
            bumpRevision()
            void load()
        }
        const timer = setInterval(() => void tick(), POLL_MS)
        return () => {
            active = false
            clearInterval(timer)
            clearTimeout(slow)
        }
    }, [approving, connectionId, check, bumpRevision, load])

    useEffect(() => {
        if (!open) return
        let active = true
        void getAppsOverviewAction(SLUG).then(result => {
            if (!active) return
            if (!result.ok) return setError(errorText(result))
            setOverview(result.value)
            const target = reconnectId ? result.value.connections.find(connection => connection.id === reconnectId) : undefined
            if (target) setScreen({ kind: 'connect', reconnect: { id: target.id, label: target.label } })
        })
        return () => {
            active = false
        }
    }, [open, reconnectId, errorText])

    // Everything a closed dialog leaves behind is reset here, so the next opening starts clean.
    const close = (next: boolean) => {
        if (next) return
        if (screen.kind === 'checkpoint') void cancelAppConnectAction(SLUG, screen.connectionId)
        closeApp()
        setOverview(null)
        setError(null)
        setScreen(ACCOUNTS)
    }

    const settle = async (outcome: ConnectOutcome) => {
        if (outcome.status === 'checkpoint') {
            setScreen({ kind: 'checkpoint', connectionId: outcome.connectionId, checkpointType: outcome.checkpointType, sentTo: outcome.sentTo })
            return
        }
        setScreen({ kind: 'success', label: outcome.label })
        bumpRevision()
        await load()
    }

    const fail = (message: string, reason?: string) => {
        setError(message)
        if (reason === 'needs_slot' || reason === 'not_entitled' || reason === 'paused') setScreen(ACCOUNTS)
    }

    const submitCredentials = async (credentials: LinkedinCredentials) => {
        setPending('connect')
        setError(null)
        const reconnect = screen.kind === 'connect' ? screen.reconnect : null
        const result = await connectLinkedinAction({ ...credentials, ...(reconnect ? { connectionId: reconnect.id } : {}) })
        setPending(null)
        if (!result.ok) return fail(errorText(result), result.reason)
        await settle(result.value)
    }

    const submitCode = async (code?: string) => {
        if (screen.kind !== 'checkpoint') return
        setPending('checkpoint')
        setError(null)
        const result = await check(screen.connectionId, code)
        setPending(null)
        if (!result.ok) return fail(errorText(result), result.reason)
        if (result.value.status === 'checkpoint' && screen.checkpointType === 'app_approval') setError(t('linkedinPro.approvalNotSeen'))
        await settle(result.value)
    }

    const resend = async () => {
        if (screen.kind !== 'checkpoint') return
        const result = await resendAppCodeAction(SLUG, screen.connectionId)
        if (result.ok) toast.success(t('linkedinPro.codeResent'))
        else setError(errorText(result))
    }

    const back = () => {
        setError(null)
        if (screen.kind === 'checkpoint') void cancelAppConnectAction(SLUG, screen.connectionId).then(() => load())
        setScreen(ACCOUNTS)
    }

    const disconnect = async (connection: AppConnectionView) => {
        setPending(connection.id)
        const result = await disconnectAppConnectionAction(SLUG, connection.id)
        setPending(null)
        if (!result.ok) return setError(errorText(result))
        bumpRevision()
        await load()
    }

    const addSlot = async () => {
        setPending('slot')
        setError(null)
        const result = await addAppSlotAction(SLUG, randomUuid())
        setPending(null)
        if (!result.ok) return setError(errorText(result))
        toast.success(result.value.trialSlot ? t('paidApp.slotAddedTrial', { price: formatNumber(0, locale, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }) }) : t('paidApp.slotAdded'))
        // The webhook moves the slot count, a moment after Stripe answers.
        setTimeout(() => void load(), 1500)
        await load()
    }

    return (
        <LinkedinProDialogView
            open={open}
            onOpenChange={close}
            overview={overview}
            screen={screen}
            pending={pending}
            error={error}
            defaultCountry={defaultCountry}
            approvalWait={approvalWait}
            onConnectStart={() => {
                setError(null)
                setScreen({ kind: 'connect', reconnect: null })
            }}
            onReconnect={connection => {
                setError(null)
                setScreen({ kind: 'connect', reconnect: { id: connection.id, label: connection.label } })
            }}
            onDisconnect={disconnect}
            onAddSlot={addSlot}
            onBack={back}
            onSubmitCredentials={submitCredentials}
            onSubmitCode={submitCode}
            onResend={resend}
            onDone={() => setScreen(ACCOUNTS)}
        />
    )
}
