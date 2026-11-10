'use client'

import { Button, Icon, ScrollFade } from '../primitives'
import { Input } from '../forms'
import { BorderBeam } from '../BorderBeam'
import { cn } from '../cn'
import { ExternalLinkIcon, LockIcon, X } from '../icons'
import { useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import type { SecretRequestItem } from '@rerun/contracts'
import { useKitTranslations } from '../locale'

export type { SecretRequestItem }

export type SecretRequestBlockProps = {
    secrets: SecretRequestItem[]
    reason?: string
    existingKeys?: string[]
    onSubmit: (values: Record<string, string>) => Promise<void> | void
    onSkip?: () => void
    // The close button, when it must mean something else than Skip. Falls back to Skip.
    onDismiss?: () => void
    disabled?: boolean
    // Rendered in the conversation's own scroll rather than pinned above the composer: no dock margin.
    inline?: boolean
    className?: string
}

export function SecretRequestBlock({ secrets, reason, existingKeys = [], onSubmit, onSkip, onDismiss, disabled, inline, className }: SecretRequestBlockProps) {
    const t = useKitTranslations()
    const blankValues = Object.fromEntries(secrets.map(item => [item.key, '']))
    const form = useForm<Record<string, string>>({ defaultValues: blankValues })
    const values = form.watch()
    const [saving, setSaving] = useState(false)
    const [submitted, setSubmitted] = useState(false)
    const [error, setError] = useState<string | null>(null)

    // The states above only drive the disabled styling. Answering the agent twice starts two runs
    // on the same conversation, so the latch that guards it has to be a ref: two callbacks fired
    // from the same render both read the same stale `saving` / `submitted`.
    const busyRef = useRef(false)

    const locked = disabled || saving || submitted
    const filled = secrets.filter(item => (values[item.key] ?? '').trim().length > 0)

    const save = async () => {
        if (disabled || busyRef.current || filled.length === 0) return
        busyRef.current = true
        setSaving(true)
        setError(null)
        try {
            await onSubmit(Object.fromEntries(filled.map(item => [item.key, values[item.key].trim()])))
            // The values only ever live in this form: drop them as soon as the engine has them.
            form.reset(blankValues)
            setSubmitted(true)
        } catch (err) {
            // The credentials were not stored, so the block has to stay answerable.
            busyRef.current = false
            setError(err instanceof Error ? err.message : t('chat.secret.saveFailed'))
        } finally {
            setSaving(false)
        }
    }

    const close = (handler: (() => void) | undefined) => {
        if (disabled || busyRef.current) return
        busyRef.current = true
        form.reset(blankValues)
        setSubmitted(true)
        handler?.()
    }
    const skip = () => close(onSkip)
    const dismiss = () => close(onDismiss ?? onSkip)

    if (secrets.length === 0) return null

    return (
        <div className={cn('relative space-y-3 overflow-hidden rounded-lg border border-border bg-muted/30 p-3', !inline && 'mb-2', className)}>
            <BorderBeam animated pattern="arcs" tone="brand" glow width={1} duration={7} />

            <div className="flex items-start gap-2.5">
                <Icon size="sm" icon={LockIcon} className="bg-background text-foreground" />
                <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="text-sm font-medium leading-snug">{secrets.length > 1 ? t('chat.secret.titleMany') : t('chat.secret.titleOne')}</p>
                    {reason && <p className="text-xs leading-snug text-muted-foreground">{reason}</p>}
                </div>
                {(onDismiss || onSkip) && (
                    <Button size="icon-sm" variant="ghost" disabled={locked} onClick={dismiss} aria-label={t('chat.secret.dismiss')} data-hitl="dismiss" className="-my-1 shrink-0 text-muted-foreground">
                        <X className="size-4" />
                    </Button>
                )}
            </div>

            <ScrollFade className="max-h-[48vh]">
                <div className="space-y-3 px-px">
                    {secrets.map(item => {
                        const alreadySet = existingKeys.includes(item.key)
                        return (
                            <div key={item.key} className="space-y-1">
                                <Input
                                    {...form.register(item.key)}
                                    type="password"
                                    label={item.label}
                                    helperText={[item.help, t('chat.secret.storedAs', { key: item.key })].filter(Boolean).join(' · ')}
                                    placeholder={alreadySet ? t('chat.secret.replacePlaceholder') : t('chat.secret.placeholder')}
                                    autoComplete="off"
                                    spellCheck={false}
                                    disabled={locked}
                                    data-hitl={`secret-${item.key}`}
                                />
                                {item.docsUrl && (
                                    <a href={item.docsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline">
                                        {t('chat.secret.whereToFind')}
                                        <ExternalLinkIcon className="size-3" />
                                    </a>
                                )}
                            </div>
                        )
                    })}
                </div>
            </ScrollFade>

            {error && <p className="text-xs text-destructive">{error}</p>}

            <div className="flex items-center justify-between gap-3">
                <p className="text-xs leading-snug text-muted-foreground/70">{t('chat.secret.storageNote')}</p>
                <div className="flex shrink-0 items-center gap-2">
                    {onSkip && (
                        <Button size="sm" variant="outline" disabled={locked} onClick={skip} data-hitl="skip">
                            {t('chat.secret.skip')}
                        </Button>
                    )}
                    <Button size="sm" disabled={locked || filled.length === 0} onClick={save} data-hitl="save">
                        {saving ? t('chat.secret.saving') : t('chat.secret.save')}
                    </Button>
                </div>
            </div>
        </div>
    )
}
