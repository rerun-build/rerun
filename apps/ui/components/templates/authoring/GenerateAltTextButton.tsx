'use client'

import { useErrorText } from '@/hooks/useErrorText'
import * as React from 'react'
import { useFormContext } from 'react-hook-form'
import { useTranslations } from 'next-intl'
import { Wand2 } from '@/lib/icons'
import { toTemplateBrief } from '@/lib/templates/describe'
import type { TemplateFormValues } from '@/lib/templates/edit-schema'
import { useTemplateAuthoring } from './actions-context'

type Props = {
    imageUrl: string
    isCover: boolean
    onGenerated: (alt: string) => void
}

export function GenerateAltTextButton({ imageUrl, isCover, onGenerated }: Props) {
    const t = useTranslations('templates.authoring')
    const errorText = useErrorText()
    const { getValues } = useFormContext<TemplateFormValues>()
    const { actions } = useTemplateAuthoring()
    const [pending, startTransition] = React.useTransition()
    const [error, setError] = React.useState<string | null>(null)

    function generate() {
        setError(null)
        startTransition(async () => {
            const result = await actions.prefillAltText({ brief: toTemplateBrief(getValues()), imageUrl, isCover })
            if (!result.ok) {
                setError(errorText(result))
                return
            }
            onGenerated(result.alt)
        })
    }

    return (
        <button
            type="button"
            onClick={generate}
            disabled={pending}
            className="shrink-0 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
            title={error ?? t('altText')}
        >
            <Wand2 className="size-4" />
        </button>
    )
}
