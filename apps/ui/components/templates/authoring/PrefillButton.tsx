'use client'

import { useErrorText } from '@/hooks/useErrorText'
import { Button } from '@rerun/ui/primitives'
import * as React from 'react'
import { useFormContext } from 'react-hook-form'
import { useTranslations } from 'next-intl'
import { Wand2 } from '@/lib/icons'
import { toTemplateBrief, type TemplateBrief } from '@/lib/templates/describe'
import type { TemplateFormValues } from '@/lib/templates/edit-schema'

type Props = {
    // The caller writes the result back into the form itself, so every section keeps ownership
    // of the fields it fills.
    run: (brief: TemplateBrief) => Promise<{ ok: true } | { ok: false; error: string }>
    label?: string
}

export function PrefillButton({ run, label }: Props) {
    const t = useTranslations('templates.authoring')
    const errorText = useErrorText()
    const { getValues } = useFormContext<TemplateFormValues>()
    const [pending, startTransition] = React.useTransition()
    const [error, setError] = React.useState<string | null>(null)

    function prefill() {
        setError(null)
        startTransition(async () => {
            const result = await run(toTemplateBrief(getValues()))
            if (!result.ok) setError(errorText(result))
        })
    }

    return (
        <div className="flex flex-col items-end gap-1">
            <Button type="button" variant="outline" size="sm" onClick={prefill} loading={pending} disabled={pending}>
                <Wand2 />
                {label ?? t('prefill')}
            </Button>
            {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
    )
}
