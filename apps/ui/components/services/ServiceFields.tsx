'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { CredentialGuide, CredentialHint } from '@/components/services/CredentialGuide'
import { FileDropzone } from '@/components/ui/file-dropzone'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { UploadIcon } from '@/lib/icons'
import type { InputDef } from '@/lib/services/manifest'

// A credential file (a service account JSON) is a few kilobytes: anything this size is another file.
const MAX_CREDENTIAL_FILE_BYTES = 64 * 1024

function MultilineField({ field, value, onChange }: { field: InputDef; value: string; onChange: (value: string) => void }) {
    const t = useTranslations('services.fields')
    const [tooLarge, setTooLarge] = useState(false)
    const read = async ([file]: File[]) => {
        if (!file) return
        setTooLarge(file.size > MAX_CREDENTIAL_FILE_BYTES)
        if (file.size <= MAX_CREDENTIAL_FILE_BYTES) onChange(await file.text())
    }
    return (
        <FileDropzone onFiles={files => void read(files)} overlayLabel={t('dropFile')}>
            {({ inputId }) => (
                <div className="space-y-1">
                    <Textarea
                        aria-label={field.label}
                        value={value}
                        placeholder={field.placeholder}
                        autoComplete="off"
                        spellCheck={false}
                        className="max-h-40 min-h-20 overflow-y-auto font-mono text-xs break-all"
                        onChange={e => onChange(e.target.value)}
                    />
                    <label htmlFor={inputId} className="inline-flex min-h-6 cursor-pointer items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                        <UploadIcon className="size-3.5" />
                        {t('chooseFile')}
                    </label>
                    {tooLarge && <p className="text-xs text-destructive">{t('fileTooLarge')}</p>}
                </div>
            )}
        </FileDropzone>
    )
}

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
                    ) : field.multiline ? (
                        <MultilineField field={field} value={values[field.key] ?? ''} onChange={v => onChange(field.key, v)} />
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
