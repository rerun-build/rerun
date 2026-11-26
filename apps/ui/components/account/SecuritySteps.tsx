'use client'

import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp'
import { PanelEditorBody, PanelEditorHeader, PanelEditorShell } from '@/components/ui/panel-editor'
import { PASSKEY_NAME_MAX } from '@/lib/auth/two-step/record'
import { CopyIcon, DownloadIcon, KeyIcon } from '@/lib/icons'
import { REGEXP_ONLY_DIGITS } from 'input-otp'
import { useTranslations } from 'next-intl'
import { useState, type FormEvent, type ReactNode } from 'react'

const CODE_LENGTH = 6

// The drill-in every step of the Security tab opens on, with its way back to the list.
function Step({ title, onBack, children }: { title: string; onBack: () => void; children: ReactNode }) {
    return (
        <PanelEditorShell>
            <PanelEditorHeader title={title} onBack={onBack} />
            <PanelEditorBody>
                <div className="mx-auto w-full max-w-sm py-4">{children}</div>
            </PanelEditorBody>
        </PanelEditorShell>
    )
}

// The key in groups of four, the way authenticator apps show it.
function groupedKey(secret: string): string {
    return secret.replace(/(.{4})/g, '$1 ').trim()
}

export function AuthenticatorAppStep({ qrCode, secret, onConfirm, onCopyKey, onBack }: { qrCode: string; secret: string; onConfirm: (code: string) => Promise<boolean>; onCopyKey: () => void; onBack: () => void }) {
    const t = useTranslations('account.security.setup.app')
    const [code, setCode] = useState('')
    const [wrong, setWrong] = useState(false)
    const [busy, setBusy] = useState(false)

    const confirm = async (value: string = code) => {
        if (value.length !== CODE_LENGTH || busy) return
        setBusy(true)
        const accepted = await onConfirm(value)
        setBusy(false)
        setWrong(!accepted)
    }

    return (
        <Step title={t('title')} onBack={onBack}>
            <div className="space-y-5">
                <div className="flex flex-col items-center gap-3">
                    {/* Supabase hands the QR code over as an SVG document, drawn black on white. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={qrCode} alt={t('qrAlt')} className="size-40 rounded-lg border border-border bg-white" />
                    {!wrong && (
                        <>
                            <p className="text-center text-xs text-muted-foreground">{t('scan')}</p>
                            <button type="button" onClick={onCopyKey} aria-label={t('copyKey')} className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-muted px-2 py-1 font-mono text-xs break-all">
                                {groupedKey(secret)}
                                <CopyIcon className="size-3 shrink-0" />
                            </button>
                        </>
                    )}
                </div>
                <div className="space-y-2">
                    {!wrong && <p className="text-center text-sm">{t('codeLabel')}</p>}
                    <InputOTP
                        maxLength={CODE_LENGTH}
                        pattern={REGEXP_ONLY_DIGITS}
                        autoComplete="one-time-code"
                        autoFocus
                        disabled={busy}
                        value={code}
                        onChange={value => {
                            setCode(value)
                            if (value.length < CODE_LENGTH) setWrong(false)
                        }}
                        onComplete={value => void confirm(value)}
                        containerClassName="justify-center"
                    >
                        <InputOTPGroup>
                            {Array.from({ length: CODE_LENGTH }, (_, index) => (
                                <InputOTPSlot key={index} index={index} aria-invalid={wrong || undefined} />
                            ))}
                        </InputOTPGroup>
                    </InputOTP>
                    {wrong && <p className="text-center text-xs text-destructive">{t('wrong')}</p>}
                </div>
                <Button type="button" className="w-full" disabled={code.length !== CODE_LENGTH} loading={busy} onClick={() => void confirm()}>
                    {t('confirm')}
                </Button>
            </div>
        </Step>
    )
}

export function BackupCodesStep({ codes, onCopy, onDownload, onDone }: { codes: string[]; onCopy: () => void; onDownload: () => void; onDone: () => void }) {
    const t = useTranslations('account.security.setup.codes')
    return (
        <Step title={t('title')} onBack={onDone}>
            <div className="space-y-4">
                <p className="text-sm text-muted-foreground">{t('intro')}</p>
                <div className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-lg border border-border bg-muted/40 p-4 font-mono text-sm">
                    {codes.map(code => (
                        <span key={code}>{code}</span>
                    ))}
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={onCopy}>
                        <CopyIcon /> {t('copy')}
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={onDownload}>
                        <DownloadIcon /> {t('download')}
                    </Button>
                </div>
                <Button type="button" className="w-full" onClick={onDone}>
                    {t('saved')}
                </Button>
            </div>
        </Step>
    )
}

export function PasskeyNameStep({ initialName, renaming, onSave, onBack }: { initialName: string; renaming: boolean; onSave: (name: string) => Promise<void>; onBack: () => void }) {
    const t = useTranslations('account.security.setup.passkey')
    const [name, setName] = useState(initialName)
    const [busy, setBusy] = useState(false)

    const save = async (event: FormEvent) => {
        event.preventDefault()
        if (!name.trim() || busy) return
        setBusy(true)
        try {
            await onSave(name)
        } finally {
            setBusy(false)
        }
    }

    return (
        <Step title={renaming ? t('renameTitle') : t('title')} onBack={onBack}>
            <form onSubmit={save} className="space-y-4">
                {!renaming && (
                    <div className="flex flex-col items-center gap-2 py-2 text-center">
                        <Icon icon={KeyIcon} size="lg" />
                        <p className="text-sm font-medium">{t('added')}</p>
                        <p className="text-xs text-muted-foreground">{t('hint')}</p>
                    </div>
                )}
                <Input value={name} onChange={event => setName(event.target.value)} autoFocus maxLength={PASSKEY_NAME_MAX} />
                <Button type="submit" className="w-full" disabled={!name.trim()} loading={busy}>
                    {t('save')}
                </Button>
            </form>
        </Step>
    )
}
