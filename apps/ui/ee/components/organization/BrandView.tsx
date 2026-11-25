'use client'

import { brandPalette, normalizeHex, type Brand } from '@rerun/contracts'
import { useTranslations } from 'next-intl'
import { useEffect, useState, type FormEvent } from 'react'

import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { FileDropzone } from '@/components/ui/file-dropzone'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { useErrorText } from '@/hooks/useErrorText'
import { XIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'

import { addressOf } from './BrandScreenPreview'
import { Browser } from './Browser'
import { BRAND_ICON_ACCEPT, BRAND_NAME_REFUSED, brandProblems, readIcon, type IconProblem } from './input'
import { Heading, Page, Section } from './parts'
import { PreviewFrame } from './PreviewFrame'
import { SquareLogo } from './SquareLogo'
import type { BrandFields, ConsoleResult, WriteBlock } from './types'
import { useBlockReason } from './useBlockReason'
import { useUnsavedGuard } from './useUnsavedGuard'

type BrandViewProps = {
    // What is saved. The view starts again from it when it changes.
    fields: BrandFields
    // The brand its previews start from.
    brand: Brand
    iconUrl: string | null
    block: WriteBlock | null
    // `color` is a full hex or an empty string, the other fields are trimmed.
    onSave: (fields: BrandFields, icon: File | null) => Promise<ConsoleResult>
}

const FORM_ID = 'organization-brand'
const PICKER_START = '#888888'

export function BrandView({ fields: saved, brand, iconUrl, block, onSave }: BrandViewProps) {
    const t = useTranslations('organization.brand')
    const tCommon = useTranslations('common')
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

    const invalid = Object.keys(problems).length > 0
    const draftBrand: Brand = { ...brand, name: draft.name.trim() || saved.name, iconUrl: shownIcon, color, supportEmail: clean.supportEmail || null }

    return (
        <>
            <Page footer={dirty && <SaveBar error={error} saving={saving} invalid={invalid} onDiscard={discard} />}>
                <div className="space-y-10">
                    <Heading
                        title={t('title')}
                        meta={blockReason}
                        actions={
                            <TooltipDisabledReason reason={blockReason}>
                                <Button type="submit" form={FORM_ID} loading={saving} disabled={blocked || !dirty || invalid}>
                                    {tCommon('save')}
                                </Button>
                            </TooltipDisabledReason>
                        }
                    />
                    <BrandCompare brand={draftBrand} />
                    <form id={FORM_ID} onSubmit={save} className="grid grid-cols-[minmax(0,1fr)] items-start gap-x-12 gap-y-10 md:grid-cols-3">
                        <Section title={t('identity')}>
                            <fieldset disabled={blocked} className="space-y-5 pt-4">
                                <Field label={t('icon')} helperText={t('iconHint')} error={iconProblem ? t(`iconProblems.${iconProblem.kind}`, { width: iconProblem.width, height: iconProblem.height }) : undefined}>
                                    <FileDropzone onFiles={files => pickIcon(files[0])} accept={BRAND_ICON_ACCEPT} disabled={blocked} overlayLabel="">
                                        {({ inputId }) => (
                                            <label htmlFor={inputId} className={cn('group flex w-fit items-center gap-4 text-sm font-medium', blocked ? 'cursor-not-allowed opacity-50' : 'cursor-pointer')}>
                                                <SquareLogo name={draft.name || saved.name} iconUrl={shownIcon} className="size-16 rounded-2xl" />
                                                <span className="underline-offset-4 group-hover:underline">{shownIcon ? t('iconReplace') : t('iconUpload')}</span>
                                            </label>
                                        )}
                                    </FileDropzone>
                                </Field>
                                <Field label={t('name')} htmlFor="brand-name" error={problemText('name')}>
                                    <Input id="brand-name" value={draft.name} aria-invalid={!!problems.name || undefined} onChange={event => set('name', event.target.value)} />
                                </Field>
                                <Field label={t('color')} htmlFor="brand-color" helperText={palette.guarded ? t('guarded', { status: palette.guarded }) : t('colorHint')} error={problemText('color')}>
                                    <div className="relative">
                                        <input
                                            type="color"
                                            aria-label={t('colorPicker')}
                                            value={color ?? PICKER_START}
                                            onChange={event => set('color', event.target.value)}
                                            className={cn('absolute start-2 top-1/2 size-6 -translate-y-1/2 cursor-pointer appearance-none overflow-hidden rounded-md border-0 bg-transparent p-0 disabled:cursor-not-allowed [&::-moz-color-swatch]:rounded-md [&::-moz-color-swatch]:border-0 [&::-webkit-color-swatch]:rounded-md [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch-wrapper]:p-0', !color && 'opacity-40')}
                                        />
                                        <Input id="brand-color" autoComplete="off" spellCheck={false} placeholder={t('colorClear')} value={draft.color} aria-invalid={!!problems.color || undefined} onChange={event => set('color', event.target.value.trim())} className="px-10 font-mono" />
                                        {draft.color && !blocked && (
                                            <Button type="button" variant="ghost" size="icon" aria-label={t('colorClear')} onClick={() => set('color', '')} className="absolute top-1/2 end-1 -translate-y-1/2 text-muted-foreground">
                                                <XIcon />
                                            </Button>
                                        )}
                                    </div>
                                </Field>
                            </fieldset>
                        </Section>
                        <Section title={t('contact')}>
                            <fieldset disabled={blocked} className="space-y-5 pt-4">
                                <Field label={t('support')} htmlFor="brand-support" helperText={t('supportHint')} error={problemText('supportEmail')}>
                                    <Input id="brand-support" type="email" placeholder={t('supportPlaceholder')} value={draft.supportEmail} aria-invalid={!!problems.supportEmail || undefined} onChange={event => set('supportEmail', event.target.value)} />
                                </Field>
                                <LinkField name="docsUrl" label={t('docs')} value={draft.docsUrl} error={problemText('docsUrl')} onChange={value => set('docsUrl', value)} />
                            </fieldset>
                        </Section>
                        <Section title={t('legal')}>
                            <fieldset disabled={blocked} className="space-y-5 pt-4">
                                <LinkField name="termsUrl" label={t('terms')} value={draft.termsUrl} error={problemText('termsUrl')} onChange={value => set('termsUrl', value)} />
                                <LinkField name="privacyUrl" label={t('privacy')} value={draft.privacyUrl} error={problemText('privacyUrl')} onChange={value => set('privacyUrl', value)} />
                            </fieldset>
                        </Section>
                    </form>
                </div>
            </Page>
            <ConfirmDialog open={guard.asking} onOpenChange={open => !open && guard.stay()} title={t('leave.title')} description={t('leave.description')} confirmLabel={t('leave.confirm')} cancelLabel={t('leave.stay')} onConfirm={guard.leave} />
        </>
    )
}

function LinkField({ name, label, value, error, onChange }: { name: keyof BrandFields; label: string; value: string; error?: string; onChange: (value: string) => void }) {
    return (
        <Field label={label} optional htmlFor={`brand-${name}`} error={error}>
            <Input id={`brand-${name}`} inputMode="url" placeholder="https://" value={value} aria-invalid={!!error || undefined} onChange={event => onChange(event.target.value)} />
        </Field>
    )
}

const PREVIEW_WIDTH = 1180

// One screen cut in two: its light half, then its dark half.
function BrandCompare({ brand }: { brand: Brand }) {
    return (
        <Browser address={addressOf(brand)}>
            <div dir="ltr" className="grid grid-cols-2">
                {(['light', 'dark'] as const).map(theme => (
                    <div key={theme} className="overflow-hidden">
                        <div className={theme === 'light' ? 'w-[200%]' : '-ms-[100%] w-[200%]'}>
                            <PreviewFrame surface="app" theme={theme} brand={brand} width={PREVIEW_WIDTH} className="aspect-[2]" />
                        </div>
                    </div>
                ))}
            </div>
        </Browser>
    )
}

function SaveBar({ error, saving, invalid, onDiscard }: { error: string | null; saving: boolean; invalid: boolean; onDiscard: () => void }) {
    const t = useTranslations('organization.brand')
    const tCommon = useTranslations('common')
    return (
        <div className="shrink-0 border-t border-border bg-card pb-[env(safe-area-inset-bottom)]">
            <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-8">
                <p className={cn('min-w-0 flex-1 basis-40 text-sm', error ? 'text-destructive' : 'text-muted-foreground')}>{error ?? t('unsaved')}</p>
                <div className="flex items-center gap-2">
                    <Button type="button" variant="ghost" disabled={saving} onClick={onDiscard}>
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

export function BrandSkeleton() {
    const t = useTranslations('organization.brand')
    const sections = [
        { title: t('identity'), fields: [t('icon'), t('name'), t('color')] },
        { title: t('contact'), fields: [t('support'), t('docs')] },
        { title: t('legal'), fields: [t('terms'), t('privacy')] },
    ]
    return (
        <Page>
            <div className="space-y-10">
                <Heading title={t('title')} actions={<Skeleton className="h-9 w-16 rounded-lg" />} />
                <Skeleton className="aspect-[1.9] w-full rounded-xl" />
                <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-x-12 gap-y-10 md:grid-cols-3">
                    {sections.map(({ title, fields }) => (
                        <Section key={title} title={title}>
                            <div className="space-y-5 pt-4">
                                {fields.map(label => (
                                    <div key={label} className="space-y-2">
                                        <p className="text-sm font-medium">{label}</p>
                                        <Skeleton className="h-10 w-full rounded-lg" />
                                    </div>
                                ))}
                            </div>
                        </Section>
                    ))}
                </div>
            </div>
        </Page>
    )
}
