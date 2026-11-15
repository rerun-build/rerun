'use client'

import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

export function BaseUrlField({ baseUrl, onCommit }: { baseUrl: string; onCommit: (value: string) => void }) {
    const t = useTranslations('connections.baseUrl')
    const [custom, setCustom] = useState(Boolean(baseUrl))
    const [value, setValue] = useState(baseUrl)

    const commit = () => {
        const trimmed = value.trim()
        if (trimmed && !/^https?:\/\//i.test(trimmed)) return
        if (trimmed !== baseUrl) onCommit(trimmed)
    }

    return (
        <div className="space-y-1.5">
            <Field orientation="row" label={t('label')} helperText={t('helper')} htmlFor="openrouter-custom-base-url">
                <Switch
                    id="openrouter-custom-base-url"
                    checked={custom}
                    onCheckedChange={checked => {
                        setCustom(checked)
                        if (!checked) {
                            setValue('')
                            if (baseUrl) onCommit('')
                        }
                    }}
                    className="shrink-0"
                />
            </Field>
            {custom && (
                <Input hideRequired autoFocus aria-label={t('inputLabel')} value={value} onChange={e => setValue(e.target.value)} onBlur={commit} placeholder="https://router.example.com/v1" className="h-8 font-mono text-xs" />
            )}
        </div>
    )
}
