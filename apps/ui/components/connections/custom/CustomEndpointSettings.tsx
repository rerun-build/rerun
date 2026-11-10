'use client'

import { DetailBlock } from '@/components/connections/DetailBlock'
import { isHttpUrl } from '@/components/connections/custom/custom-endpoint'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import type { BoxConnection, UpdateBoxConnectionInput } from '@/lib/engine/types'
import { CUSTOM_DEFAULT_CONTEXT_WINDOW } from '@rerun/contracts'
import { formatNumber } from '@rerun/i18n/format'
import { useLocale, useTranslations } from 'next-intl'
import { useState } from 'react'

type CustomEndpointSettingsProps = {
    connection: BoxConnection
    onPatch: (patch: UpdateBoxConnectionInput) => void
}

function parseWindow(value: string): number | null | undefined {
    const trimmed = value.trim().replace(/[\s_,]/g, '')
    if (!trimmed) return null
    const parsed = Number(trimmed)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

// What the server does not say about itself. Each field saves on blur, like the rest of the detail;
// a value that could not be valid yet is an edit in progress, not something to send.
export function CustomEndpointSettings({ connection, onPatch }: CustomEndpointSettingsProps) {
    const t = useTranslations('connections.custom')
    const locale = useLocale()
    const [baseUrl, setBaseUrl] = useState(connection.baseUrl ?? '')
    const [contextWindow, setContextWindow] = useState(connection.contextWindow ? String(connection.contextWindow) : '')

    const commitBaseUrl = () => {
        const next = baseUrl.trim()
        if (isHttpUrl(next) && next !== connection.baseUrl) onPatch({ baseUrl: next })
    }

    const commitWindow = () => {
        const next = parseWindow(contextWindow)
        if (next !== undefined && next !== (connection.contextWindow ?? null)) onPatch({ contextWindow: next })
    }

    return (
        <DetailBlock title={t('endpoint')}>
            <div className="space-y-3">
                <Input id={`custom-base-url-${connection.id}`} hideRequired label={t('baseUrl')} value={baseUrl} onChange={e => setBaseUrl(e.target.value)} onBlur={commitBaseUrl} inputMode="url" spellCheck={false} className="h-8 font-mono text-xs" />
                <Input
                    id={`custom-context-${connection.id}`}
                    optional
                    label={t('contextWindow')}
                    value={contextWindow}
                    onChange={e => setContextWindow(e.target.value)}
                    onBlur={commitWindow}
                    inputMode="numeric"
                    placeholder={formatNumber(CUSTOM_DEFAULT_CONTEXT_WINDOW, locale)}
                    helperText={t('contextWindowHelper')}
                    className="h-8 font-mono text-xs"
                />
                <Field orientation="row" label={t('vision')} helperText={t('visionHelper')} htmlFor={`custom-vision-${connection.id}`}>
                    <Switch id={`custom-vision-${connection.id}`} checked={connection.vision === true} onCheckedChange={vision => onPatch({ vision })} className="shrink-0" />
                </Field>
            </div>
        </DetailBlock>
    )
}
