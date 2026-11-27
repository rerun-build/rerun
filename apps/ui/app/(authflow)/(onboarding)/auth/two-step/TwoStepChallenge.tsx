'use client'

import { finishPasskeySignInAction, spendBackupCodeAction, startPasskeySignInAction } from '@/app/api/_actions/two-step.actions'
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
import { startAuthentication } from '@simplewebauthn/browser'
import { REGEXP_ONLY_DIGITS } from 'input-otp'
import { useTranslations } from 'next-intl'
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'

const CODE_LENGTH = 6
type Screen = 'passkey' | 'app' | 'backup'

// Which method leads on this browser next time. A cookie rather than a call: the session changing
// under the page cuts any request still on its way.
const LAST_METHOD_MAX_AGE = 400 * 24 * 60 * 60
function remember(method: 'passkey' | 'app') {
    document.cookie = `${TWO_STEP_LAST_COOKIE}=${method}; path=/; max-age=${LAST_METHOD_MAX_AGE}; samesite=lax`
}

const onOwnAddress = () => window.location.pathname === TWO_STEP_PATH

// A full load, so the proxy reads the raised session from its cookies.
function enter(next: string) {
    window.location.assign(next)
}

export function TwoStepChallenge({
    next,
    appFactorId,
    hasPasskeys,
    first,
    hasBackupCodes,
    panel,
}: {
    next: string
    appFactorId: string | null
    hasPasskeys: boolean
    first: 'passkey' | 'app' | 'backup'
    hasBackupCodes: boolean
    panel: ReactNode
}) {
    const t = useTranslations('auth.twoStep')
    const errorText = useErrorText()
    const [screen, setScreen] = useState<Screen>(first)
    const [code, setCode] = useState('')
    const [backupCode, setBackupCode] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)
    const promptedOnce = useRef(false)

    // The proxy sends a navigation of the app here and the router keeps the address it asked for. It
    // posts this page's actions there, where the session they raise is lost: a full load of this page's
    // own address first, before any action.
    useEffect(() => {
        if (!onOwnAddress()) window.location.replace(next === routes.home ? TWO_STEP_PATH : `${TWO_STEP_PATH}?next=${encodeURIComponent(next)}`)
    }, [next])


    const show = (target: Screen) => {
        setError(null)
        setCode('')
        setBackupCode('')
        setScreen(target)
    }

    // Every passkey of the account is offered: the browser's window shows the ones this device holds.
    const confirmWithPasskey = async () => {
        if (busy) return
        setBusy(true)
        setError(null)
        const failed = (message: string) => {
            setBusy(false)
            setError(message)
        }
        const started = await startPasskeySignInAction()
        if (!started.ok) return failed(t('passkey.failed'))
        const response = await startAuthentication({ optionsJSON: started.options }).catch(() => null)
        if (!response) return failed(t('passkey.failed'))
        const finished = await finishPasskeySignInAction({ response })
        if (!finished.ok) return failed(finished.code === 'backupCodeTooManyTries' ? errorText(finished) : t('passkey.failed'))
        remember('passkey')
        enter(next)
    }

    // The browser's own passkey window opens by itself on the screen that leads with it.
    useEffect(() => {
        if (screen !== 'passkey' || promptedOnce.current || !hasPasskeys || !onOwnAddress()) return
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
    if (screen === 'app' && hasPasskeys) links.push({ label: t('usePasskey'), onClick: () => show('passkey') })
    if (hasBackupCodes) links.push({ label: t('useBackup'), onClick: () => show('backup') })
    links.push({ label: t('otherAccount'), onClick: () => void signInWithAnotherAccount() })

    const heading =
        screen === 'passkey'
            ? { title: t('passkey.title'), subtitle: t('passkey.subtitle') }
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
