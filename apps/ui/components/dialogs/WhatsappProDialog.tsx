'use client'

import { useErrorText } from '@/hooks/useErrorText'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { formatNumber } from '@rerun/i18n/format'
import { useLocale, useTranslations } from 'next-intl'
import { addAppSlotAction, cancelAppConnectAction, connectWhatsappAction, disconnectAppConnectionAction, getAppsOverviewAction, submitAppCheckpointAction } from '@/app/api/_actions/apps.actions'
import type { AppConnectionView, AppsOverview, ConnectOutcome } from '@/app/api/_services/apps.service'
import type { WhatsappConnectInput, WhatsappLinkMethod } from '@/components/apps/WhatsappProViews'
import { WhatsappProDialogView, type WhatsappProScreen } from '@/components/dialogs/WhatsappProDialogView'
import { countryFromLocale } from '@/lib/phone/normalize'
import { usePaidAppsStore } from '@/stores/paid-apps.store'
import { randomUuid } from '@/lib/random-uuid'

const SLUG = 'whatsapp'
const ACCOUNTS: WhatsappProScreen = { kind: 'accounts' }
const POLL_MS = 3_000
const DEFAULT_CODE_LIFETIME_S = 180

type CheckpointResult = Awaited<ReturnType<typeof submitAppCheckpointAction>>
type LinkRequest = WhatsappConnectInput & { reconnect: { id: string; label: string | null } | null }

// On a phone the QR code would be on the very screen that has to scan it.
function preferredMethod(): WhatsappLinkMethod {
    return typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches ? 'code' : 'qr'
}

export function WhatsappProDialog() {
    const t = useTranslations('dialogs')
    const errorText = useErrorText()
    const locale = useLocale()
    const open = usePaidAppsStore(s => s.openSlug === SLUG)
    const reconnectId = usePaidAppsStore(s => s.reconnectId)
    const closeApp = usePaidAppsStore(s => s.closeApp)
    const bumpRevision = usePaidAppsStore(s => s.bumpRevision)

    const [overview, setOverview] = useState<AppsOverview | null>(null)
    const [screen, setScreen] = useState<WhatsappProScreen>(ACCOUNTS)
    const [pending, setPending] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [defaultMethod, setDefaultMethod] = useState<WhatsappLinkMethod>('qr')
    const [defaultCountry] = useState(() => countryFromLocale(typeof navigator === 'undefined' ? undefined : navigator.language))
    // What the link screen was opened with, to ask for a new code or switch method with the same.
    const lastRequest = useRef<LinkRequest | null>(null)

    const load = useCallback(async () => {
        const result = await getAppsOverviewAction(SLUG)
        if (result.ok) setOverview(result.value)
        else setError(errorText(result))
        return result.ok ? result.value : null
    }, [errorText])

    // One checkpoint call at a time: two answers of "connected" landing together would finish the
    // connection twice, and the second one deletes the account.
    const inFlight = useRef<Promise<CheckpointResult> | null>(null)
    const check = useCallback((connectionId: string) => {
        if (inFlight.current) return inFlight.current
        const call = submitAppCheckpointAction(SLUG, connectionId).finally(() => {
            inFlight.current = null
        })
        inFlight.current = call
        return call
    }, [])

    const linking = open && screen.kind === 'link' && !screen.expired ? screen : null
    const linkingId = linking?.connectionId ?? null
    const lifetimeMs = (linking?.link?.expiresInSeconds ?? DEFAULT_CODE_LIFETIME_S) * 1000

    // The phone links in its own time and only Linkup sees it: asked every few seconds, which also
    // brings the QR code WhatsApp renews while it waits. A failed poll stays silent until the code
    // runs out.
    useEffect(() => {
        if (!linkingId) return
        let active = true
        const expire = setTimeout(() => setScreen(current => (current.kind === 'link' && current.connectionId === linkingId ? { ...current, expired: true } : current)), lifetimeMs)
        const tick = async () => {
            if (!active || inFlight.current) return
            const result = await check(linkingId).catch(() => null)
            if (!active || !result) return
            if (!result.ok) {
                if (result.reason !== 'refused') return
                setError(errorText(result))
                setScreen(current => (current.kind === 'link' ? { ...current, expired: true } : current))
                return
            }
            const outcome = result.value
            if (outcome.status === 'connected') {
                setScreen({ kind: 'success', label: outcome.label })
                bumpRevision()
                void load()
                return
            }
            if (outcome.link) {
                const fresh = outcome.link
                setScreen(current => (current.kind === 'link' && current.connectionId === linkingId ? { ...current, link: { ...fresh, pairingCode: fresh.pairingCode ?? current.link?.pairingCode ?? null } } : current))
            }
        }
        const timer = setInterval(() => void tick(), POLL_MS)
        return () => {
            active = false
            clearInterval(timer)
            clearTimeout(expire)
        }
    }, [linkingId, lifetimeMs, check, bumpRevision, load, errorText])

    useEffect(() => {
        if (!open) return
        let active = true
        void getAppsOverviewAction(SLUG).then(result => {
            if (!active) return
            if (!result.ok) return setError(errorText(result))
            setOverview(result.value)
            const target = reconnectId ? result.value.connections.find(connection => connection.id === reconnectId) : undefined
            if (target) {
                setDefaultMethod(preferredMethod())
                setScreen({ kind: 'connect', reconnect: { id: target.id, label: target.label } })
            }
        })
        return () => {
            active = false
        }
    }, [open, reconnectId, errorText])

    const abandonLink = () => {
        if (screen.kind === 'link') void cancelAppConnectAction(SLUG, screen.connectionId)
    }

    // Everything a closed dialog leaves behind is reset here, so the next opening starts clean.
    const close = (next: boolean) => {
        if (next) return
        abandonLink()
        closeApp()
        setOverview(null)
        setError(null)
        setScreen(ACCOUNTS)
        lastRequest.current = null
    }

    const settle = async (outcome: ConnectOutcome, request: LinkRequest) => {
        if (outcome.status === 'checkpoint') {
            setScreen({ kind: 'link', connectionId: outcome.connectionId, method: request.method, phoneNumber: request.phoneNumber, link: outcome.link, expired: false })
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

    const requestLink = async (request: LinkRequest) => {
        setPending('connect')
        setError(null)
        // A new code is a new sign-in at Linkup: the one still waiting is dropped first.
        if (screen.kind === 'link') await cancelAppConnectAction(SLUG, screen.connectionId)
        lastRequest.current = request
        const result = await connectWhatsappAction({ phoneNumber: request.phoneNumber, pairingCode: request.method === 'code', ...(request.reconnect ? { connectionId: request.reconnect.id } : {}) })
        setPending(null)
        if (!result.ok) {
            if (screen.kind === 'link') setScreen({ kind: 'connect', reconnect: request.reconnect })
            return fail(errorText(result), result.reason)
        }
        await settle(result.value, request)
    }

    const submitNumber = (input: WhatsappConnectInput) => {
        void requestLink({ ...input, reconnect: screen.kind === 'connect' ? screen.reconnect : null })
    }

    const newCode = () => {
        if (lastRequest.current) void requestLink(lastRequest.current)
    }

    const switchMethod = () => {
        if (lastRequest.current) void requestLink({ ...lastRequest.current, method: lastRequest.current.method === 'qr' ? 'code' : 'qr' })
    }

    const back = () => {
        setError(null)
        if (screen.kind === 'link') void cancelAppConnectAction(SLUG, screen.connectionId).then(() => load())
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

    const startConnect = (reconnect: { id: string; label: string | null } | null) => {
        setError(null)
        setDefaultMethod(preferredMethod())
        setScreen({ kind: 'connect', reconnect })
    }

    return (
        <WhatsappProDialogView
            open={open}
            onOpenChange={close}
            overview={overview}
            screen={screen}
            pending={pending}
            error={error}
            defaultCountry={defaultCountry}
            defaultMethod={defaultMethod}
            onConnectStart={() => startConnect(null)}
            onReconnect={connection => startConnect({ id: connection.id, label: connection.label })}
            onDisconnect={disconnect}
            onAddSlot={addSlot}
            onBack={back}
            onSubmitNumber={submitNumber}
            onNewCode={newCode}
            onSwitchMethod={switchMethod}
            onDone={() => setScreen(ACCOUNTS)}
        />
    )
}
