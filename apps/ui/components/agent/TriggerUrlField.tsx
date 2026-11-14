'use client'

import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { CheckIcon, CopyIcon, Loader2Icon, RotateCwIcon } from '@/lib/icons'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'

function useTriggerUrl(agentId: string, slug: string, token: string): string {
    const path = `/api/t/${agentId}/${slug}/${token}`
    const [origin, setOrigin] = useState('')
    useEffect(() => setOrigin(window.location.origin), [])
    return `${origin}${path}`
}

type TriggerUrlFieldProps = {
    agentId: string
    slug: string
    token: string
    rotating: boolean
    onRotate: () => void
    rotateDisabledReason?: string
}

export function TriggerUrlField({ agentId, slug, token, rotating, onRotate, rotateDisabledReason }: TriggerUrlFieldProps) {
    const t = useTranslations('agent.triggerUrlField')
    const [copied, setCopied] = useState(false)
    const url = useTriggerUrl(agentId, slug, token)

    function copy() {
        navigator.clipboard
            .writeText(url)
            .then(() => {
                setCopied(true)
                setTimeout(() => setCopied(false), 1200)
            })
            .catch(() => {})
    }

    if (!token) {
        return (
            <Field label={t('label')} helperText={t('noSecretHelper')}>
                <div className="flex items-center gap-1.5">
                    <p className="flex min-h-8 min-w-0 flex-1 items-center rounded-md border border-dashed border-input px-3 py-1.5 text-xs text-muted-foreground">{t('noSecret')}</p>
                    <TooltipDisabledReason reason={rotateDisabledReason}>
                        <Button size="sm" variant="outline" onClick={onRotate} disabled={rotating || !!rotateDisabledReason}>
                            {rotating ? <Loader2Icon className="size-3.5 animate-spin" /> : t('getUrl')}
                        </Button>
                    </TooltipDisabledReason>
                </div>
            </Field>
        )
    }

    return (
        <Field label={t('label')} helperText={t('helper')}>
            <div className="flex items-center gap-1.5">
                <code className="flex h-8 min-w-0 flex-1 items-center truncate rounded-md border border-input bg-muted/40 px-3 font-mono text-xs">{url}</code>
                <Button size="icon-sm" variant="outline" aria-label={t('copy')} onClick={copy}>
                    {copied ? <CheckIcon className="size-3.5 text-emerald-500" /> : <CopyIcon className="size-3.5" />}
                </Button>
                <TooltipDisabledReason reason={rotateDisabledReason}>
                    <ConfirmDialog
                        title={t('rotateConfirm')}
                        description={t('rotateDescription')}
                        confirmVariant="default"
                        confirmLabel={t('rotateAction')}
                        onConfirm={onRotate}
                    >
                        <Button size="icon-sm" variant="outline" aria-label={t('rotate')} title={rotateDisabledReason ? undefined : t('rotate')} disabled={rotating || !!rotateDisabledReason}>
                            {rotating ? <Loader2Icon className="size-3.5 animate-spin" /> : <RotateCwIcon className="size-3.5" />}
                        </Button>
                    </ConfirmDialog>
                </TooltipDisabledReason>
            </div>
        </Field>
    )
}
