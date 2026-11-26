'use client'

import {
    finishTwoStepSetupAction,
    getSecurityAction,
    newBackupCodesAction,
    removeTwoStepMethodAction,
    renamePasskeyAction,
    signOutOtherSessionsAction,
    signOutSessionAction,
    type SecurityPasskey,
    type SecurityState,
} from '@/app/api/_actions/two-step.actions'
import type { ActionResult } from '@/app/api/_actions/space.actions'
import { SecurityPanel } from '@/components/account/SecurityPanel'
import { AuthenticatorAppStep, BackupCodesStep, PasskeyNameStep } from '@/components/account/SecuritySteps'
import { useBrand } from '@/components/brand/BrandProvider'
import { PanelSteps } from '@/components/ui/panel-steps'
import { useErrorText } from '@/hooks/useErrorText'
import { desktopShell } from '@/lib/desktop-shell/client'
import { randomUuid } from '@/lib/random-uuid'
import { createClient } from '@/supabase/client'
import { useSession } from '@/supabase/session/SessionProvider'
import { isWhiteLabel } from '@rerun/contracts'
import type { MFAVerifyWebauthnParams } from '@supabase/supabase-js'
import { useTranslations } from 'next-intl'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

type Step =
    | { kind: 'list' }
    | { kind: 'app'; factorId: string; qrCode: string; secret: string }
    | { kind: 'codes'; codes: string[] }
    | { kind: 'name'; factorId: string; name: string; renaming: boolean; codes: string[] | null }

type PasskeyNameKey = 'mac' | 'iphone' | 'ipad' | 'windows' | 'android' | 'chromebook' | 'passkey'

// A first name for a new passkey, from the device it was made on: the person renames it if it is wrong.
function passkeyNameKey(userAgent: string): PasskeyNameKey {
    if (/iPhone/.test(userAgent)) return 'iphone'
    if (/iPad/.test(userAgent)) return 'ipad'
    if (/Android/.test(userAgent)) return 'android'
    if (/CrOS/.test(userAgent)) return 'chromebook'
    if (/Macintosh|Mac OS X/.test(userAgent)) return 'mac'
    if (/Windows/.test(userAgent)) return 'windows'
    return 'passkey'
}

// A name Supabase keeps unique per account; the one the person reads is the hub's.
function factorName(): string {
    return `passkey-${randomUuid().slice(0, 8)}`
}

// Supabase's `webauthn.register` always asks the browser for a security key (cross-platform, and an
// undefined override is skipped), which keeps Touch ID, Face ID and Windows Hello out of its window.
// So the ceremony is run here, on Supabase's own challenge, with any authenticator welcome.
async function createPasskey(friendlyName: string): Promise<string> {
    const mfa = createClient().auth.mfa
    const { data: factor, error: enrollError } = await mfa.webauthn.enroll({ friendlyName })
    if (enrollError || !factor) throw enrollError ?? new Error('enroll')
    const webauthn = { rpId: window.location.hostname, rpOrigins: [window.location.origin] }
    const { data: challenge, error: challengeError } = await mfa.challenge({ factorId: factor.id, webauthn })
    if (challengeError || !challenge || challenge.type !== 'webauthn' || challenge.webauthn.type !== 'create') throw challengeError ?? new Error('challenge')
    const publicKey = challenge.webauthn.credential_options.publicKey
    const credential = await navigator.credentials.create({ publicKey: { ...publicKey, authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' } } as PublicKeyCredentialCreationOptions })
    if (!credential) throw new Error('cancelled')
    const { error: verifyError } = await mfa.verify({ factorId: factor.id, challengeId: challenge.id, webauthn: { ...webauthn, type: 'create', credential_response: credential as MFAVerifyWebauthnParams<'create'>['webauthn']['credential_response'] } })
    if (verifyError) throw verifyError
    return factor.id
}

// A setup left half way keeps an unverified factor, which counts against the account's ten.
async function dropUnfinished(type: 'totp' | 'webauthn') {
    const mfa = createClient().auth.mfa
    const { data: factors } = await mfa.listFactors()
    for (const factor of factors?.all ?? []) {
        if (factor.factor_type === type && factor.status === 'unverified') await mfa.unenroll({ factorId: factor.id })
    }
}

export function SecurityTab() {
    const t = useTranslations('account.security')
    const errorText = useErrorText()
    const brand = useBrand()
    const { session } = useSession()
    const [security, setSecurity] = useState<SecurityState | null>(null)
    const [step, setStep] = useState<Step>({ kind: 'list' })
    const [busy, setBusy] = useState<string | null>(null)
    const [noPlatformPasskey, setNoPlatformPasskey] = useState(false)

    // A load that finished a setup cut short hands back its backup codes, shown once.
    const applyLoad = (result: Awaited<ReturnType<typeof getSecurityAction>>) => {
        if (!result.ok) {
            toast.error(errorText(result))
            return
        }
        setSecurity(result.security)
        if (result.codes) setStep({ kind: 'codes', codes: result.codes })
    }

    const load = async () => applyLoad(await getSecurityAction())

    // One read per opening: the one that finishes a cut-short setup hands its codes back once only, so
    // an effect run twice (React's strict mode) shares it rather than asking again.
    const firstLoad = useRef<ReturnType<typeof getSecurityAction> | null>(null)
    useEffect(() => {
        let mounted = true
        firstLoad.current ??= getSecurityAction()
        void firstLoad.current.then(result => {
            if (mounted) applyLoad(result)
        })
        return () => {
            mounted = false
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // The desktop app's window reaches a security key but not always Touch ID: a passkey is then added
    // from the browser, where it syncs back to this computer.
    useEffect(() => {
        if (!desktopShell() || typeof PublicKeyCredential === 'undefined') return
        void PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
            .then(available => setNoPlatformPasskey(!available))
            .catch(() => setNoPlatformPasskey(true))
    }, [])
    // The auth server ties every passkey to the hub's own address: an organization's address has none.
    const addPasskeyUnavailable = isWhiteLabel(brand) ? t('passkeys.notHere') : noPlatformPasskey ? t('passkeys.addInBrowser') : undefined

    const backToList = async () => {
        await load()
        setStep({ kind: 'list' })
    }

    const refused = (result: ActionResult) => {
        if (result.ok) return false
        toast.error(errorText(result))
        return true
    }

    const setUpApp = async () => {
        setBusy('app')
        try {
            const mfa = createClient().auth.mfa
            await dropUnfinished('totp')
            const { data, error } = await mfa.enroll({ factorType: 'totp', friendlyName: t('app.title'), issuer: brand.name })
            if (error || !data) throw error ?? new Error()
            setStep({ kind: 'app', factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret })
        } catch {
            toast.error(errorText({ code: 'twoStepSetupFailed' }))
        } finally {
            setBusy(null)
        }
    }

    const leaveAppSetup = async () => {
        if (step.kind === 'app') await createClient().auth.mfa.unenroll({ factorId: step.factorId }).catch(() => {})
        setStep({ kind: 'list' })
    }

    const confirmApp = async (code: string): Promise<boolean> => {
        if (step.kind !== 'app') return false
        const { error } = await createClient().auth.mfa.challengeAndVerify({ factorId: step.factorId, code })
        if (error) return false
        const result = await finishTwoStepSetupAction({ factorId: step.factorId })
        if (refused(result) || !result.ok) return true
        if (result.codes) setStep({ kind: 'codes', codes: result.codes })
        else await backToList()
        return true
    }

    const addPasskey = async () => {
        setBusy('passkey')
        try {
            await dropUnfinished('webauthn')
            const factorId = await createPasskey(factorName())
            const name = t(`passkeyNames.${passkeyNameKey(navigator.userAgent)}`)
            const result = await finishTwoStepSetupAction({ factorId, passkeyName: name })
            if (refused(result) || !result.ok) return
            setStep({ kind: 'name', factorId, name, renaming: false, codes: result.codes })
        } catch (error) {
            console.warn('[two-step] passkey not added', error)
            toast.error(t('passkeys.failed'))
        } finally {
            setBusy(null)
        }
    }

    const savePasskeyName = async (name: string) => {
        if (step.kind !== 'name') return
        if (refused(await renamePasskeyAction({ factorId: step.factorId, name }))) return
        if (step.codes) setStep({ kind: 'codes', codes: step.codes })
        else await backToList()
    }

    const leavePasskeyName = async () => {
        if (step.kind === 'name' && step.codes) setStep({ kind: 'codes', codes: step.codes })
        else await backToList()
    }

    const renamePasskey = (passkey: SecurityPasskey) => setStep({ kind: 'name', factorId: passkey.id, name: passkey.name, renaming: true, codes: null })

    const removeMethod = async (factorId: string) => {
        setBusy(factorId)
        try {
            if (refused(await removeTwoStepMethodAction({ factorId }))) return
            await createClient().auth.refreshSession()
            await load()
        } finally {
            setBusy(null)
        }
    }

    const newCodes = async () => {
        setBusy('codes')
        try {
            const result = await newBackupCodesAction()
            if (refused(result) || !result.ok) return
            setStep({ kind: 'codes', codes: result.codes })
        } finally {
            setBusy(null)
        }
    }

    const signOutSession = async (sessionId: string) => {
        setBusy(sessionId)
        try {
            if (refused(await signOutSessionAction({ sessionId }))) return
            toast.success(t('sessions.signedOut'))
            await load()
        } finally {
            setBusy(null)
        }
    }

    const signOutOthers = async () => {
        setBusy('others')
        try {
            if (refused(await signOutOtherSessionsAction())) return
            toast.success(t('sessions.signedOut'))
            await load()
        } finally {
            setBusy(null)
        }
    }

    const copy = async (text: string, done: string) => {
        await navigator.clipboard.writeText(text)
        toast.success(done)
    }

    const downloadCodes = (codes: string[]) => {
        const heading = t('setup.codes.fileHeading', { account: session?.user.email ?? '' })
        const file = new Blob([`${heading}\n\n${codes.join('\n')}\n`], { type: 'text/plain' })
        const link = document.createElement('a')
        link.href = URL.createObjectURL(file)
        link.download = `${brand.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-backup-codes.txt`
        link.click()
        URL.revokeObjectURL(link.href)
    }

    if (step.kind === 'app') {
        return (
            <PanelSteps stepKey="app" depth={1}>
                <AuthenticatorAppStep qrCode={step.qrCode} secret={step.secret} onConfirm={confirmApp} onCopyKey={() => void copy(step.secret, t('setup.app.keyCopied'))} onBack={() => void leaveAppSetup()} />
            </PanelSteps>
        )
    }

    if (step.kind === 'codes') {
        return (
            <PanelSteps stepKey="codes" depth={1}>
                <BackupCodesStep codes={step.codes} onCopy={() => void copy(step.codes.join('\n'), t('setup.codes.copied'))} onDownload={() => downloadCodes(step.codes)} onDone={() => void backToList()} />
            </PanelSteps>
        )
    }

    if (step.kind === 'name') {
        return (
            <PanelSteps stepKey={`name-${step.factorId}`} depth={1}>
                <PasskeyNameStep initialName={step.name} renaming={step.renaming} onSave={savePasskeyName} onBack={() => void leavePasskeyName()} />
            </PanelSteps>
        )
    }

    return (
        <PanelSteps stepKey="list" depth={0}>
            <SecurityPanel
                security={security}
                addPasskeyUnavailable={addPasskeyUnavailable}
                busy={busy}
                onSetUpApp={() => void setUpApp()}
                onAddPasskey={() => void addPasskey()}
                onRenamePasskey={renamePasskey}
                onRemoveMethod={factorId => void removeMethod(factorId)}
                onNewCodes={() => void newCodes()}
                onSignOutSession={sessionId => void signOutSession(sessionId)}
                onSignOutOthers={() => void signOutOthers()}
            />
        </PanelSteps>
    )
}
