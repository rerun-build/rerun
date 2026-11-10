'use client'

import { useState, type FormEvent } from 'react'
import { useTranslations } from 'next-intl'
import type { CountryCode } from 'libphonenumber-js/min'
import type { LinkupLinkCode } from '@/lib/apps/linkup/client'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { PanelScroller } from '@/components/ui/panel-list'
import { PhoneNumberInput } from '@/components/ui/phone-number-input'
import { Segmented } from '@/components/ui/segmented'
import { Skeleton } from '@/components/ui/skeleton'
import { countryOfTyped, toE164 } from '@/lib/phone/normalize'
import { AlertCircleIcon, BellRing, LockIcon, RefreshCw, SendIcon, ShieldCheckIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { StepHero, type AppPresentation } from './PaidAppViews'

// A QR code to scan from another screen, or a code to type when the dialog is on the phone itself.
export type WhatsappLinkMethod = 'qr' | 'code'

export type WhatsappConnectInput = { phoneNumber: string; method: WhatsappLinkMethod }

export const WHATSAPP_PRESENTATION: AppPresentation = {
    slug: 'whatsapp',
    capabilities: [
        { icon: SendIcon, key: 'whatsappReplies' },
        { icon: BellRing, key: 'whatsappMessages' },
        { icon: ShieldCheckIcon, key: 'whatsappCareful' },
    ],
}

const METHODS: WhatsappLinkMethod[] = ['qr', 'code']

type ConnectScreenProps = {
    defaultCountry: CountryCode
    defaultMethod: WhatsappLinkMethod
    // A reconnect links the same number again, so it comes filled in.
    initialPhone?: string
    pending: boolean
    error: string | null
    onSubmit: (input: WhatsappConnectInput) => void
}

export function WhatsappConnectScreen({ defaultCountry, defaultMethod, initialPhone = '', pending, error, onSubmit }: ConnectScreenProps) {
    const [phone, setPhone] = useState(initialPhone)
    const [country, setCountry] = useState<CountryCode>(defaultCountry)
    const [method, setMethod] = useState<WhatsappLinkMethod>(defaultMethod)
    const [invalid, setInvalid] = useState(false)
    const t = useTranslations('apps.whatsapp.connect')

    const submit = (event: FormEvent) => {
        event.preventDefault()
        if (pending) return
        const phoneNumber = toE164(phone, countryOfTyped(phone, country))
        setInvalid(!phoneNumber)
        if (phoneNumber) onSubmit({ phoneNumber, method })
    }

    return (
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
            <PanelScroller className="space-y-4 p-4">
                <PhoneNumberInput
                    label={t('phoneLabel')}
                    autoFocus
                    value={phone}
                    onChange={value => {
                        setInvalid(false)
                        setPhone(value)
                    }}
                    country={country}
                    onCountryChange={setCountry}
                />
                {invalid && <p className="-mt-2 text-[11px] text-destructive">{t('invalidPhone')}</p>}
                <Field label={t('linkBy')} helperText={method === 'qr' ? t('linkByQr') : t('linkByCode')}>
                    <Segmented options={METHODS.map(value => ({ value, label: t(`method.${value}`) }))} value={method} onChange={setMethod} />
                </Field>
                <p className="flex items-start gap-1.5 text-xs text-pretty text-muted-foreground">
                    <LockIcon className="mt-px size-3.5 shrink-0" />
                    {t('linkedDevice')}
                </p>
                {error && (
                    <Alert variant="danger">
                        <AlertCircleIcon />
                        <AlertDescription>{error}</AlertDescription>
                    </Alert>
                )}
            </PanelScroller>
            <footer className="flex justify-end border-t px-4 py-3">
                <Button type="submit" loading={pending} className="max-sm:w-full">
                    {t('submit')}
                </Button>
            </footer>
        </form>
    )
}

type LinkScreenProps = {
    method: WhatsappLinkMethod
    phoneNumber: string
    link: LinkupLinkCode | null
    expired: boolean
    pending: boolean
    error: string | null
    onNewCode: () => void
    onSwitchMethod: () => void
}

// The code is shown until the phone links it, checked every few seconds; the QR code renews on its
// own while it waits. Past its three minutes, a new one is asked for.
export function WhatsappLinkScreen({ method, phoneNumber, link, expired, pending, error, onNewCode, onSwitchMethod }: LinkScreenProps) {
    const t = useTranslations('apps.whatsapp.link')
    const steps = [t('steps.open'), t('steps.settings'), method === 'qr' ? t('steps.pointQr') : t('steps.typeCode')]

    return (
        <>
            <PanelScroller className="flex flex-col items-center px-5 pt-6 pb-6">
                <StepHero visual={<LinkCode method={method} link={link} expired={expired} />} title={expired ? t('expiredTitle') : method === 'qr' ? t('scanTitle') : t('typeTitle')}>
                    {expired ? t('expiredBody') : t.rich('onPhone', { phone: phoneNumber, b: chunks => <span className="font-medium whitespace-nowrap text-foreground">{chunks}</span> })}
                </StepHero>
                {!expired && (
                    <ol className="mt-5 w-full max-w-sm space-y-2">
                        {steps.map((step, index) => (
                            <li key={step} className="flex items-start gap-3 text-sm">
                                <span className="flex size-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-medium text-muted-foreground tabular-nums">{index + 1}</span>
                                <span className="min-w-0 text-pretty">{step}</span>
                            </li>
                        ))}
                    </ol>
                )}
                {!expired && (
                    <span className="mt-5 inline-flex items-center gap-2 rounded-full border bg-muted/30 px-3 py-1 text-xs text-muted-foreground">
                        <span className="size-1.5 animate-pulse rounded-full bg-primary" />
                        {t('waiting')}
                    </span>
                )}
            </PanelScroller>
            <footer className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t px-4 py-3">
                {error ? (
                    <p className="min-w-0 flex-1 text-[11px] text-destructive">{error}</p>
                ) : (
                    <Button variant="ghost" size="sm" className="text-muted-foreground max-sm:w-full" disabled={pending} onClick={onSwitchMethod}>
                        {method === 'qr' ? t('switchToCode') : t('switchToQr')}
                    </Button>
                )}
                <Button variant={expired || error ? 'default' : 'outline'} loading={pending} onClick={onNewCode} className="max-sm:w-full">
                    <RefreshCw />
                    {t('newCode')}
                </Button>
            </footer>
        </>
    )
}

function LinkCode({ method, link, expired }: { method: WhatsappLinkMethod; link: LinkupLinkCode | null; expired: boolean }) {
    const t = useTranslations('apps.whatsapp.link')
    if (method === 'code') {
        const code = link?.pairingCode ?? null
        return (
            <div className={cn('mb-4 rounded-xl border bg-muted/30 px-5 py-4', expired && 'opacity-40')}>
                {code ? (
                    <span aria-label={t('codeLabel', { code: code.split('').join(' ') })} className="font-mono text-2xl font-semibold tracking-[0.3em] tabular-nums sm:text-3xl">
                        {code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code}
                    </span>
                ) : (
                    <Skeleton className="h-8 w-44" />
                )}
            </div>
        )
    }
    // A QR code is read on a white ground whatever the theme: the phone's camera needs the contrast.
    return (
        <div className={cn('mb-4 rounded-xl border bg-white p-3', expired && 'opacity-30')}>
            {link?.qrCodeImage ? <img src={link.qrCodeImage} alt={t('qrAlt')} className="size-44 sm:size-52" /> : <Skeleton className="size-44 bg-neutral-200 sm:size-52" />}
        </div>
    )
}
