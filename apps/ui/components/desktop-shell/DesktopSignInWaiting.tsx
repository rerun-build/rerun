'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { desktopShell } from '@/lib/desktop-shell/client'
import type { DesktopSignInError, DesktopSignInProvider } from '@rerun/contracts'
import { useTranslations } from 'next-intl'
import { useEffect, useState, type FormEvent } from 'react'
import { startDesktopBrowserSignIn, stopWaitingForBrowser } from './desktop-sign-in'

// What the desktop app's sign-in page shows while the person signs in in their browser. The app
// reloads on its own once the browser hands the code back; the code can also be pasted by hand.
export function DesktopSignInWaiting({ provider }: { provider: DesktopSignInProvider }) {
    const t = useTranslations('desktopShell.signIn')
    const [error, setError] = useState<DesktopSignInError | null>(null)
    const [pasting, setPasting] = useState(false)
    const [code, setCode] = useState('')
    const [submitting, setSubmitting] = useState(false)

    useEffect(() => {
        const shell = desktopShell('auth')
        if (!shell) return
        return shell.auth.onResult((result) => {
            if (result.status === 'error') setError(result.reason)
        })
    }, [])

    const submit = async (event: FormEvent) => {
        event.preventDefault()
        const shell = desktopShell('auth')
        if (!shell || !code.trim()) return
        setSubmitting(true)
        setError(null)
        const result = await shell.auth.submitCode(code)
        if (result.status === 'error') setError(result.reason)
        setSubmitting(false)
    }

    return (
        <div className="space-y-6">
            <div className="space-y-2 text-center">
                <h2 className="text-lg font-medium">{t('waitingTitle')}</h2>
                <p className="text-sm text-muted-foreground text-balance">{t('waitingBody')}</p>
                {error && (
                    <p role="alert" className="text-sm text-destructive">
                        {t(`errors.${error}`)}
                    </p>
                )}
            </div>
            {pasting ? (
                <form onSubmit={submit} className="space-y-3">
                    <Input label={t('codeLabel')} value={code} onChange={(event) => setCode(event.target.value)} autoFocus spellCheck={false} autoComplete="off" className="font-mono" />
                    <Button type="submit" className="w-full" loading={submitting} disabled={!code.trim()}>
                        {t('submit')}
                    </Button>
                </form>
            ) : (
                <div className="flex flex-col gap-2">
                    <Button variant="outline" className="w-full" onClick={() => void startDesktopBrowserSignIn(provider)}>
                        {t('reopen')}
                    </Button>
                    <Button variant="ghost" className="w-full" onClick={() => setPasting(true)}>
                        {t('pasteCode')}
                    </Button>
                </div>
            )}
            <Button variant="ghost" className="w-full text-muted-foreground" onClick={stopWaitingForBrowser}>
                {t('back')}
            </Button>
        </div>
    )
}
