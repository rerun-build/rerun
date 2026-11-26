'use client'

import { spendBackupCodeAction } from '@/app/api/_actions/two-step.actions'
import { useErrorText } from '@/hooks/useErrorText'
import { OnboardingHeading, OnboardingPage, OnboardingStepLayout } from '@/components/onboarding/OnboardingPage'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp'
import { KeyIcon } from '@/lib/icons'
import { TWO_STEP_LAST_COOKIE, TWO_STEP_PATH } from '@/lib/auth/two-step/gate'
import { routes } from '@/lib/routes'
import { createClient } from '@/supabase/client'
import { REGEXP_ONLY_DIGITS } from 'input-otp'
import { useTranslations } from 'next-intl'
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'

const CODE_LENGTH = 6
type Screen = 'passkey' | 'app' | 'backup' | 'pick'
type Passkey = { id: string; name: string }

// Supabase's client hints at a security key by default: the device's own passkey is as welcome. Its
// type asks for a whole request, of which only the hints are overridden here.
const ANY_AUTHENTICATOR = { hints: [] } as unknown as Parameters<ReturnType<typeof createClient>['auth']['mfa']['webauthn']['authenticate']>[1]

// The passkey this browser went through last, per account: a WebAuthn challenge names one factor.
const passkeyMemory = (userId: string) => `rerun.two-step.passkey.${userId}`

function rememberedPasskey(userId: string, passkeys: Passkey[]): Passkey | undefined {
    try {
        const id = window.localStorage.getItem(passkeyMemory(userId))
        return passkeys.find(passkey => passkey.id === id)
    } catch {
        return undefined
    }
}

// Which method leads on this browser next time. A cookie rather than a call: the session changing
// under the page cuts any request still on its way.
const LAST_METHOD_MAX_AGE = 400 * 24 * 60 * 60
function remember(method: 'passkey' | 'app') {
    document.cookie = `${TWO_STEP_LAST_COOKIE}=${method}; path=/; max-age=${LAST_METHOD_MAX_AGE}; samesite=lax`
}

// A full load, so the proxy reads the raised session from its cookies.
function enter(next: string) {
    window.location.assign(next)
}

export function TwoStepChallenge({
    next,
    userId,
    appFactorId,
    passkeys,
    first,
    hasBackupCodes,
    panel,
}: {
    next: string
    userId: string
    appFactorId: string | null
    passkeys: Passkey[]
    first: 'passkey' | 'app' | 'backup'
    hasBackupCodes: boolean
    panel: ReactNode
}) {
    const t = useTranslations('auth.twoStep')
    const errorText = useErrorText()
    const [screen, setScreen] = useState<Screen>(first)
    const [picked, setPicked] = useState<Passkey | undefined>()
    const [code, setCode] = useState('')
    const [backupCode, setBackupCode] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)
    const promptedOnce = useRef(false)

    // The proxy sends a navigation of the app here and the router keeps showing the address it asked
    // for: put this page's own back, or the actions of this page are posted to another one.
    useEffect(() => {
        if (window.location.pathname === TWO_STEP_PATH) return
        window.history.replaceState(window.history.state, '', next === routes.home ? TWO_STEP_PATH : `${TWO_STEP_PATH}?next=${encodeURIComponent(next)}`)
    }, [next])


    const show = (target: Screen) => {
        setError(null)
        setCode('')
        setBackupCode('')
        setScreen(target)
    }

    const confirmWithPasskey = async (passkey: Passkey | undefined = picked ?? rememberedPasskey(userId, passkeys) ?? passkeys[0]) => {
        if (!passkey || busy) return
        setBusy(true)
        setError(null)
        const { error: failed } = await createClient().auth.mfa.webauthn.authenticate({ factorId: passkey.id, webauthn: {} }, ANY_AUTHENTICATOR)
        if (failed) {
            setBusy(false)
            setError(t('passkey.failed'))
            return
        }
        try {
            window.localStorage.setItem(passkeyMemory(userId), passkey.id)
        } catch {
            // Private mode: the next sign-in offers the most recent passkey instead.
        }
        remember('passkey')
        enter(next)
    }

    // The browser's own passkey window opens by itself on the screen that leads with it.
    useEffect(() => {
        if (screen !== 'passkey' || promptedOnce.current || !passkeys.length) return
        promptedOnce.current = true
        void confirmWithPasskey()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [screen])

    const verifyCode = async (value: string = code) => {
        if (!appFactorId || value.length !== CODE_LENGTH || busy) return
        setBusy(true)
        setError(null)
        const { error: failed } = await createClient().auth.mfa.challengeAndVerify({ factorId: appFactorId, code: value })
        if (failed) {
            setBusy(false)
            setError(t('code.wrong'))
            return
        }
        remember('app')
        enter(next)
    }

    const verifyBackupCode = async (event: FormEvent) => {
        event.preventDefault()
        if (!backupCode.trim() || busy) return
        setBusy(true)
        setError(null)
        const result = await spendBackupCodeAction({ code: backupCode })
        if (!result.ok) {
            setBusy(false)
            setError(errorText(result))
            return
        }
        enter(next)
    }

    const signInWithAnotherAccount = async () => {
        await createClient()
            .auth.signOut({ scope: 'local' })
            .catch(() => {})
        enter(next === routes.home ? routes.auth : `${routes.auth}?next=${encodeURIComponent(next)}`)
    }

    const links: { label: string; onClick: () => void }[] = []
    if (screen !== 'app' && appFactorId) links.push({ label: t('useApp'), onClick: () => show('app') })
    if (screen === 'app' && passkeys.length) links.push({ label: t('usePasskey'), onClick: () => show('passkey') })
    if (screen === 'passkey' && passkeys.length > 1) links.push({ label: t('passkey.another'), onClick: () => show('pick') })
    if (hasBackupCodes) links.push({ label: t('useBackup'), onClick: () => show('backup') })
    links.push({ label: t('otherAccount'), onClick: () => void signInWithAnotherAccount() })

    const heading =
        screen === 'passkey'
            ? { title: t('passkey.title'), subtitle: t('passkey.subtitle') }
            : screen === 'pick'
              ? { title: t('passkey.pickTitle'), subtitle: t('passkey.pickSubtitle') }
              : screen === 'backup'
                ? { title: t('backup.title'), subtitle: t('backup.subtitle') }
                : { title: t('code.title'), subtitle: t('code.subtitle') }

    return (
        <OnboardingPage stepKey={`two-step-${screen}`} panel={panel}>
            <OnboardingStepLayout heading={<OnboardingHeading title={heading.title} subtitle={heading.subtitle} />}>
                {screen === 'passkey' && (
                    <div className="space-y-3">
                        <div className="flex justify-center py-3">
                            <Icon icon={KeyIcon} size="xl" />
                        </div>
                        {error && <p className="text-center text-xs text-destructive">{error}</p>}
                        <Button type="button" className="w-full" loading={busy} onClick={() => void confirmWithPasskey()}>
                            {t('passkey.use')}
                        </Button>
                        <OtherWays links={links} />
                    </div>
                )}

                {screen === 'pick' && (
                    <div className="space-y-3">
                        <div className="flex flex-col gap-2">
                            {passkeys.map(passkey => (
                                <Button
                                    key={passkey.id}
                                    type="button"
                                    variant="outline"
                                    className="w-full justify-start"
                                    disabled={busy}
                                    onClick={() => {
                                        setPicked(passkey)
                                        setScreen('passkey')
                                        void confirmWithPasskey(passkey)
                                    }}
                                >
                                    <KeyIcon />
                                    <span className="truncate">{passkey.name}</span>
                                </Button>
                            ))}
                        </div>
                        <OtherWays links={[{ label: t('backup.back'), onClick: () => show(first) }]} />
                    </div>
                )}

                {screen === 'app' && (
                    <div className="space-y-3">
                        <InputOTP
                            maxLength={CODE_LENGTH}
                            pattern={REGEXP_ONLY_DIGITS}
                            autoComplete="one-time-code"
                            autoFocus
                            disabled={busy}
                            value={code}
                            onChange={value => {
                                setCode(value)
                                setError(null)
                            }}
                            onComplete={value => void verifyCode(value)}
                            containerClassName="justify-center"
                        >
                            <InputOTPGroup>
                                {Array.from({ length: CODE_LENGTH }, (_, index) => (
                                    <InputOTPSlot key={index} index={index} aria-invalid={error ? true : undefined} />
                                ))}
                            </InputOTPGroup>
                        </InputOTP>
                        {error && <p className="text-center text-xs text-destructive">{error}</p>}
                        <Button type="button" className="w-full" loading={busy} disabled={code.length !== CODE_LENGTH} onClick={() => void verifyCode()}>
                            {t('code.verify')}
                        </Button>
                        <OtherWays links={links} />
                    </div>
                )}

                {screen === 'backup' && (
                    <form onSubmit={verifyBackupCode} className="space-y-3">
                        <Input
                            value={backupCode}
                            onChange={event => {
                                setBackupCode(event.target.value)
                                setError(null)
                            }}
                            placeholder={t('backup.placeholder')}
                            autoComplete="one-time-code"
                            autoCapitalize="characters"
                            spellCheck={false}
                            autoFocus
                            aria-invalid={error ? true : undefined}
                            className="h-10 text-center font-mono tracking-widest"
                        />
                        {error && <p className="text-center text-xs text-destructive">{error}</p>}
                        <Button type="submit" className="w-full" loading={busy} disabled={!backupCode.trim()}>
                            {t('backup.verify')}
                        </Button>
                        <OtherWays links={first === 'backup' ? links.slice(-1) : [{ label: t('backup.back'), onClick: () => show(first) }]} />
                    </form>
                )}
            </OnboardingStepLayout>
        </OnboardingPage>
    )
}

function OtherWays({ links }: { links: { label: string; onClick: () => void }[] }) {
    return (
        <div className="flex flex-col items-center gap-1 pt-2">
            {links.map(link => (
                <Button key={link.label} type="button" variant="link" size="sm" className="text-muted-foreground" onClick={link.onClick}>
                    {link.label}
                </Button>
            ))}
        </div>
    )
}
