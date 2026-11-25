'use client'

import { brandPalette, normalizeHex } from '@rerun/contracts'
import { useTranslations } from 'next-intl'
import { useEffect, useState, type FormEvent } from 'react'

import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { FileDropzone } from '@/components/ui/file-dropzone'
import { Input } from '@/components/ui/input'
import { useErrorText } from '@/hooks/useErrorText'
import { UploadIcon, XIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'

import { BrandPreview } from './BrandPreview'
import { ConsolePage } from './ConsolePage'
import { BRAND_ICON_ACCEPT, BRAND_NAME_REFUSED, brandProblems, readIcon, type IconProblem } from './input'
import { SquareLogo } from './SquareLogo'
import type { BrandFields, ConsoleResult, WriteBlock } from './types'
import { useBlockReason } from './useBlockReason'
import { useUnsavedGuard } from './useUnsavedGuard'

type BrandViewProps = {
    // What is saved. The view starts again from it when it changes.
    fields: BrandFields
    iconUrl: string | null
    block: WriteBlock | null
    // `color` is a full hex or an empty string, the other fields are trimmed.
    onSave: (fields: BrandFields, icon: File | null) => Promise<ConsoleResult>
}

const FORM_ID = 'organization-brand'
const PICKER_START = '#888888'

const LINKS = [
    { key: 'docsUrl', label: 'docs' },
    { key: 'termsUrl', label: 'terms' },
    { key: 'privacyUrl', label: 'privacy' },
] as const

export function BrandView({ fields: saved, iconUrl, block, onSave }: BrandViewProps) {
    const t = useTranslations('organization.brand')
    const errorText = useErrorText()
    const blockReason = useBlockReason(block)
    const [draft, setDraft] = useState(saved)
    const [icon, setIcon] = useState<{ file: File; url: string } | null>(null)
    const [iconProblem, setIconProblem] = useState<IconProblem | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [saving, setSaving] = useState(false)

    const savedKey = JSON.stringify(saved)
    const [startedFrom, setStartedFrom] = useState(savedKey)
    if (startedFrom !== savedKey) {
        setStartedFrom(savedKey)
        setDraft(saved)
    }

    const pickedUrl = icon?.url
    useEffect(() => () => void (pickedUrl && URL.revokeObjectURL(pickedUrl)), [pickedUrl])

    // What a save would write, to tell a real change from a space typed after the name or a color
    // written another way.
    const clean = { ...(Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, value.trim()])) as BrandFields), color: normalizeHex(draft.color) ?? draft.color.trim() }
    const dirty = !!icon || JSON.stringify(clean) !== JSON.stringify({ ...saved, color: normalizeHex(saved.color) ?? saved.color })
    const problems = brandProblems(draft)
    const blocked = !!blockReason
    const guard = useUnsavedGuard(dirty)
    const color = normalizeHex(draft.color)
    const palette = brandPalette(color)
    const shownIcon = icon?.url ?? iconUrl

    const set = (key: keyof BrandFields, value: string) => {
        setError(null)
        setDraft(current => ({ ...current, [key]: value }))
    }
    const problemText = (key: keyof BrandFields) => {
        const problem = problems[key]
        if (!problem) return undefined
        return problem === 'nameInvalid' ? t('nameInvalid', { list: BRAND_NAME_REFUSED }) : t(problem)
    }

    const pickIcon = async (file: File) => {
        const problem = await readIcon(file)
        setIconProblem(problem)
        if (!problem) setIcon({ file, url: URL.createObjectURL(file) })
    }

    const discard = () => {
        setDraft(saved)
        setIcon(null)
        setIconProblem(null)
        setError(null)
    }

    const save = async (event: FormEvent) => {
        event.preventDefault()
        if (!dirty || blocked || saving || Object.keys(problems).length > 0) return
        setSaving(true)
        setError(null)
        const result = await onSave({ ...clean, color: color ?? '' }, icon?.file ?? null)
        setSaving(false)
        if (!result.ok) return setError(errorText(result))
        setIcon(null)
    }

    return (
        <>
            <ConsolePage
                title={t('title')}
                description={blockReason ?? t('description')}
                footer={dirty && <SaveBar error={error} saving={saving} invalid={Object.keys(problems).length > 0} onDiscard={discard} />}
            >
                <form id={FORM_ID} onSubmit={save} className="grid items-start gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)]">
                    <fieldset disabled={blocked} className="min-w-0 space-y-5">
                        <Field label={t('name')} htmlFor="brand-name" error={problemText('name')}>
                            <Input id="brand-name" value={draft.name} aria-invalid={!!problems.name || undefined} onChange={event => set('name', event.target.value)} />
                        </Field>
                        <Field label={t('icon')} helperText={t('iconHint')} error={iconProblem ? t(`iconProblems.${iconProblem.kind}`, { width: iconProblem.width, height: iconProblem.height }) : undefined}>
                            <FileDropzone onFiles={files => pickIcon(files[0])} accept={BRAND_ICON_ACCEPT} disabled={blocked} overlayLabel="">
                                {({ inputId }) => (
                                    <label htmlFor={inputId} className={cn('flex items-center gap-4 rounded-lg border border-dashed border-input p-3 transition-colors', blocked ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:border-foreground/40')}>
                                        <SquareLogo name={draft.name || saved.name} iconUrl={shownIcon} className="size-14" />
                                        <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
                                            <UploadIcon className="size-4 shrink-0 text-muted-foreground" />
                                            {shownIcon ? t('iconReplace') : t('iconUpload')}
                                        </span>
                                    </label>
                                )}
                            </FileDropzone>
                        </Field>
                        <Field label={t('color')} htmlFor="brand-color" helperText={palette.guarded ? t('guarded', { status: palette.guarded }) : t('colorHint')} error={problemText('color')}>
                            <div className="flex items-center gap-2">
                                <input type="color" aria-label={t('colorPicker')} value={color ?? PICKER_START} onChange={event => set('color', event.target.value)} className={cn('h-10 w-12 shrink-0 cursor-pointer rounded-lg border border-input bg-background p-1 disabled:cursor-not-allowed disabled:opacity-50', !color && 'opacity-40')} />
                                <div className="relative min-w-0 flex-1">
                                    <Input id="brand-color" autoComplete="off" spellCheck={false} placeholder={t('colorClear')} value={draft.color} aria-invalid={!!problems.color || undefined} onChange={event => set('color', event.target.value.trim())} className="pe-10 font-mono" />
                                    {draft.color && !blocked && (
                                        <Button type="button" variant="ghost" size="icon" aria-label={t('colorClear')} onClick={() => set('color', '')} className="absolute top-1 end-1 text-muted-foreground">
                                            <XIcon />
                                        </Button>
                                    )}
                                </div>
                            </div>
                        </Field>
                    </fieldset>
                    <div className="min-w-0 lg:sticky lg:top-8 lg:col-start-2 lg:row-span-2 lg:row-start-1">
                        <BrandPreview name={draft.name || saved.name} iconUrl={shownIcon} palette={palette} />
                    </div>
                    <fieldset disabled={blocked} className="min-w-0 space-y-5">
                        <Field label={t('support')} htmlFor="brand-support" helperText={t('supportHint')} error={problemText('supportEmail')}>
                            <Input id="brand-support" type="email" placeholder={t('supportPlaceholder')} value={draft.supportEmail} aria-invalid={!!problems.supportEmail || undefined} onChange={event => set('supportEmail', event.target.value)} />
                        </Field>
                        {LINKS.map(({ key, label }) => (
                            <Field key={key} label={t(label)} optional htmlFor={`brand-${key}`} error={problemText(key)}>
                                <Input id={`brand-${key}`} inputMode="url" placeholder="https://" value={draft[key]} aria-invalid={!!problems[key] || undefined} onChange={event => set(key, event.target.value)} />
                            </Field>
                        ))}
                    </fieldset>
                </form>
            </ConsolePage>
            <ConfirmDialog open={guard.asking} onOpenChange={open => !open && guard.stay()} title={t('leave.title')} description={t('leave.description')} confirmLabel={t('leave.confirm')} cancelLabel={t('leave.stay')} onConfirm={guard.leave} />
        </>
    )
}

function SaveBar({ error, saving, invalid, onDiscard }: { error: string | null; saving: boolean; invalid: boolean; onDiscard: () => void }) {
    const t = useTranslations('organization.brand')
    const tCommon = useTranslations('common')
    return (
        <div className="shrink-0 border-t bg-background pb-[env(safe-area-inset-bottom)]">
            <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-8">
                <p className={cn('min-w-0 flex-1 basis-40 text-sm', error ? 'text-destructive' : 'text-muted-foreground')}>{error ?? t('unsaved')}</p>
                <div className="flex items-center gap-2">
                    <Button type="button" variant="outline" disabled={saving} onClick={onDiscard}>
                        {t('discard')}
                    </Button>
                    <Button type="submit" form={FORM_ID} loading={saving} disabled={invalid}>
                        {tCommon('save')}
                    </Button>
                </div>
            </div>
        </div>
    )
}
