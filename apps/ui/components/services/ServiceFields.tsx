'use client'

import { useTranslations } from 'next-intl'
import { CredentialGuide, CredentialHint } from '@/components/services/CredentialGuide'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { InputDef } from '@/lib/services/manifest'

type ServiceFieldsProps = {
    inputs: InputDef[]
    values: Record<string, string>
    onChange: (key: string, value: string) => void
}

// Presentational credential inputs shared by the inline ServiceConfigForm (chat + Services tab).
// Renders a select or input per field based on its type.
export function ServiceFields({ inputs, values, onChange }: ServiceFieldsProps) {
    const t = useTranslations('services.fields')
    return (
        <div className="space-y-2.5">
            {inputs.map(field => (
                <div key={field.key} className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">
                        {field.label}
                        {field.required && <span className="text-amber-400"> *</span>}
                    </label>
                    {field.type === 'select' ? (
                        <Select value={values[field.key] ?? ''} onValueChange={v => onChange(field.key, v)}>
                            <SelectTrigger className="h-8 w-full text-sm">
                                <SelectValue placeholder={field.placeholder ?? t('selectPlaceholder')} />
                            </SelectTrigger>
                            <SelectContent>
                                {(field.options ?? []).map(opt => (
                                    <SelectItem key={opt.value} value={opt.value}>
                                        {opt.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    ) : (
                        <Input
                            type={field.secret || field.type === 'password' ? 'password' : field.type === 'url' ? 'url' : 'text'}
                            value={values[field.key] ?? ''}
                            placeholder={field.placeholder}
                            autoComplete="off"
                            className="h-8 text-sm"
                            onChange={e => onChange(field.key, e.target.value)}
                        />
                    )}
                    {field.help && <CredentialHint help={field.help} />}
                    {field.guide && <CredentialGuide label={field.label} guide={field.guide} />}
                </div>
            ))}
        </div>
    )
}
