'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PlusIcon } from '@/lib/icons'
import { useTranslations } from 'next-intl'
import { useState, type ReactNode } from 'react'
import { useForm } from 'react-hook-form'

type CustomModelListProps = {
    models: string[]
    onChange: (next: string[]) => void
    reserved: string[]
    hint?: ReactNode
    placeholder?: string
}

export function CustomModelList({ models, onChange, reserved, hint, placeholder = 'vendor/model' }: CustomModelListProps) {
    const t = useTranslations('connections.customModels')
    const [adding, setAdding] = useState(false)
    const form = useForm<{ draft: string }>({ defaultValues: { draft: '' } })
    const draft = form.watch('draft')

    const submit = form.handleSubmit(({ draft }) => {
        const value = draft.trim()
        if (!value || models.includes(value) || reserved.includes(value)) return
        onChange([...models, value])
        form.reset({ draft: '' })
    })

    return (
        <div className="space-y-2 border-t pt-3">
            {models.length > 0 && (
                <div className="space-y-0.5">
                    {models.map(id => (
                        <div key={id} className="flex items-center justify-between gap-2 py-1.5">
                            <span className="truncate font-mono text-xs">{id}</span>
                            <button type="button" onClick={() => onChange(models.filter(m => m !== id))} className="shrink-0 text-xs text-destructive">
                                {t('remove')}
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {adding ? (
                <div className="space-y-2">
                    <p className="text-[11px] text-muted-foreground">
                        {hint ?? t.rich('openrouterHint', { mono: chunks => <span className="font-mono">{chunks}</span> })}
                    </p>
                    <form onSubmit={submit} className="flex items-center gap-2">
                        <div className="flex-1">
                            <Input hideRequired autoFocus placeholder={placeholder} className="h-8 font-mono text-xs" {...form.register('draft')} />
                        </div>
                        <Button type="submit" size="sm" variant="outline" disabled={!draft.trim()}>
                            {t('add')}
                        </Button>
                    </form>
                </div>
            ) : (
                <Button type="button" size="sm" variant="outline" onClick={() => setAdding(true)} className="w-full gap-1.5">
                    <PlusIcon className="size-3.5" />
                    {t('addCustom')}
                </Button>
            )}
        </div>
    )
}
